const fs = require('fs');
const { ethers } = require('ethers');
const { expect } = require('chai');
const { describe, it } = require('mocha');
const {
	Client,
	AccountId,
	PrivateKey,
	AccountCreateTransaction,
	Hbar,
	ContractCreateFlow,
	TransferTransaction,
	// eslint-disable-next-line no-unused-vars
	ContractFunctionParameters,
	HbarUnit,
	ContractExecuteTransaction,
	// eslint-disable-next-line no-unused-vars
	ContractId,
	AccountInfoQuery,
	ContractCallQuery,
} = require('@hashgraph/sdk');
const { default: axios } = require('axios');
require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME;
const env = process.env.ENVIRONMENT ?? null;

const baseUrlForMainnet = 'https://mainnet-public.mirrornode.hedera.com';
const baseUrlForTestnet = 'https://testnet.mirrornode.hedera.com';

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let contractId;
let contractAddress;
let abi, iface;
let alicePK, aliceId;
let bobPk, bobId;
let client;
let baseUrl;

describe('Deployment: ', function() {
	it('Should deploy the contract and setup conditions', async function() {
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
			process.exit(1);
		}

		console.log('\n-Using ENIVRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('testing in *TESTNET*');
			baseUrl = baseUrlForTestnet;
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('testing in *MAINNET*');
			baseUrl = baseUrlForMainnet;
		}
		else {
			console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
			return;
		}

		client.setOperator(operatorId, operatorKey);
		// deploy the contract
		console.log('\n-Using Operator:', operatorId.toString());

		// create Alice account [Wallet A]
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(alicePK, 50);
		console.log('Alice account ID:', aliceId.toString(), '\nkey:', alicePK.toString(), 'as Wallet A');

		// create Bob account [Wallet B]
		bobPk = PrivateKey.generateED25519();
		bobId = await accountCreator(bobPk, 10);
		console.log('Bob account ID:', bobId.toString(), '\nkey:', bobPk.toString(), 'as Wallet B');

		console.log('\nUsing Operator', operatorId.toString(), ' as Wallet C');

		const gasLimit = 500_000;

		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		// import ABI
		abi = json.abi;
		iface = new ethers.utils.Interface(abi);

		const contractBytecode = json.bytecode;

		console.log('\n- Deploying contract...', contractName, '\n\tgas@', gasLimit);

		contractId = await contractDeployFcn(contractBytecode, gasLimit);
		contractAddress = contractId.toSolidityAddress();

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;

		console.log('\n-Testing:', contractName);

		await sleep(3000);
		await checkLastMirrorEvent();
	});
});

describe('Contract Tests: ', function() {
	it('Check the deployment worked and parties to escrow match', async function() {
		const [walletA, walletB, walletC] = await getSettings('getParties', 'commisioner', 'worker', 'referee');
		expect(AccountId.fromSolidityAddress(walletA).toString()).to.equal(aliceId.toString());
		expect(AccountId.fromSolidityAddress(walletB).toString()).to.equal(bobId.toString());
		expect(AccountId.fromSolidityAddress(walletC).toString()).to.equal(operatorId.toString());
	});

	it('Alice should fund the contract', async function() {
		// check Alice balance
		client.setOperator(aliceId, alicePK);
		const aliceHbarBal = await getAccountBalance(aliceId);

		const [contractExecuteRx] = await contractExecuteFcn(contractId, 200_000, 'fundEscrow', [], new Hbar(10, HbarUnit.Hbar));
		expect(contractExecuteRx.status.toString() == 'SUCESS').to.be.true;

		expect(aliceHbarBal.toBigNumber().minus(10).toNumber()).to.be.greaterThan((await getAccountBalance(aliceId)).toBigNumber().toNumber());
		await checkLastMirrorEvent();
	});

	it('Operator should *NOT* be able to fund the contract', async function() {
		client.setOperator(operatorId, operatorKey);
		let errorCount = 0;
		try	{
			await contractExecuteFcn(contractId, 200_000, 'fundEscrow', [], new Hbar(10, HbarUnit.Hbar));
		}
		catch (err) {
			// iface.parseError(errorName)
			console.log('Error:', err);
			errorCount++;
		}
		expect(errorCount).to.equal(1);
	});

	it('Bob checks if the contract is funded', async function() {
		client.setOperator(bobId, bobPk);
		const fundedBalance = await getSettings('isFunded', 'balance');
		expect(new Hbar(fundedBalance, HbarUnit.Tinybar).toTinybars() == new Hbar(10, HbarUnit.Hbar).toTinybars()).to.be.true;
	});

	it('Bob cannot trigger fund release', async function() {
		client.setOperator(bobId, bobPk);
		let errorCount = 0;
		try	{
			await contractExecuteFcn(contractId, 200_000, 'release', []);
		}
		catch (err) {
			// iface.parseError(errorName)
			console.log('Error:', err);
			errorCount++;
		}
		expect(errorCount).to.equal(1);
	});

	it('Alice should be able to trigger fund release', async function() {
		// check Bob gets paid
		const bobHbarBal = await getAccountBalance(bobId);
		client.setOperator(aliceId, alicePK);
		await contractExecuteFcn(contractId, 200_000, 'release', []);
		expect(bobHbarBal.toBigNumber().plus(10).toNumber()).to.be.equal((await getAccountBalance(bobId)).toBigNumber().toNumber());
	});

	it('Alice funds and Wallet C triggers release', async function() {
		// check Alice gets paid

		// check Alice balance
		client.setOperator(aliceId, alicePK);
		const aliceHbarBal = await getAccountBalance(aliceId);
		const [contractExecuteRx] = await contractExecuteFcn(contractId, 200_000, 'fundEscrow', [], new Hbar(10, HbarUnit.Hbar));
		expect(contractExecuteRx.status.toString() == 'SUCESS').to.be.true;

		expect(aliceHbarBal.toBigNumber().minus(10).toNumber()).to.be.greaterThan((await getAccountBalance(aliceId)).toBigNumber().toNumber());

		client.setOperator(operatorId, operatorKey);
		await contractExecuteFcn(contractId, 200_000, 'release', []);
		// not checking for exact numbers due to tx costs
		expect(aliceHbarBal.toBigNumber().minus(3).toNumber()).to.be.lessThan((await getAccountBalance(aliceId)).toBigNumber().toNumber());
	});
});

describe('Clean up: ', function() {
	it('Fetch hbar', async function() {
		// get Alice balance
		let aliceHbarBal = await getAccountBalance(aliceId);
		// SDK transfer back to operator
		client.setOperator(aliceId, alicePK);
		let receipt = await hbarTransferFcn(aliceId, operatorId, aliceHbarBal.toBigNumber().minus(0.05));
		console.log('Clean-up -> Retrieve hbar from Alice');
		// reverting operator as Alice should be drained
		client.setOperator(operatorId, operatorKey);
		aliceHbarBal = await getAccountBalance(aliceId);
		console.log('Alice ending hbar balance:', aliceHbarBal.toString());
		expect(receipt == 'SUCCESS').to.be.true;
		let bobHbarBal = await getAccountBalance(bobId);
		// SDK transfer back to operator
		client.setOperator(bobId, bobPk);
		receipt = await hbarTransferFcn(bobId, operatorId, bobHbarBal.toBigNumber().minus(0.05));
		console.log('Clean-up -> Retrieve hbar from Bob');
		// reverting operator as Alice should be drained
		client.setOperator(operatorId, operatorKey);
		bobHbarBal = await getAccountBalance(bobId);
		console.log('Bob ending hbar balance:', bobHbarBal.toString());
		expect(receipt == 'SUCCESS').to.be.true;
	});
});

/**
 * Helper function to deploy the contract
 * @param {string} bytecode bytecode from compiled SOL file
 * @param {number} gasLim gas limit as a number
 * @returns {ContractId | null} the contract ID or null if failed
 */
async function contractDeployFcn(bytecode, gasLim) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setConstructorParameters(
			new ContractFunctionParameters()
				.addAddress(aliceId.toSolidityAddress())
				.addAddress(bobId.toSolidityAddress())
				.addAddress(operatorId.toSolidityAddress()),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	return contractCreateRx.contractId;
}

/**
 * Helper function to get the current settings of the contract
 * @param {string} fcnName the name of the getter to call
 * @param {string} expectedVars the variable to exeppect to get back
 * @return {*} array of results
 */
// eslint-disable-next-line no-unused-vars
async function getSettings(fcnName, ...expectedVars) {

	const encodedCommand = iface.encodeFunctionData(fcnName, []);
	console.log('Encoded command:', encodedCommand);

	// query the contract
	const contractCall = await new ContractCallQuery()
		.setContractId(contractId)
		.setFunctionParameters(Buffer.from(encodedCommand.slice(2), 'hex'))
		.setQueryPayment(new Hbar(0.01))
		.setGas(100_000)
		.execute(client);
	const queryResult = iface.decodeFunctionResult(fcnName, contractCall.bytes);

	const results = [];
	for (let v = 0 ; v < expectedVars.length; v++) {
		results.push(queryResult[expectedVars[v]]);
	}
	return results;
}

/**
 * Helper function for calling the contract methods
 * @param {ContractId} cId the contract to call
 * @param {number | Long.Long} gasLim the max gas
 * @param {string} fcnName name of the function to call
 * @param {ContractFunctionParameters} params the function arguments
 * @param {string | number | Hbar | Long.Long | BigNumber} amountHbar the amount of hbar to send in the methos call
 * @returns {[TransactionReceipt, any, TransactionRecord]} the transaction receipt and any decoded results
 */
async function contractExecuteFcn(cId, gasLim, fcnName, params, amountHbar = 0) {
	console.log('Calling', fcnName, 'with params', params);
	const encodedCommand = iface.encodeFunctionData(fcnName, params);
	console.log('Encoded command:', encodedCommand);
	// convert to UINT8ARRAY after stripping the '0x'
	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunctionParameters(Buffer.from(encodedCommand.slice(2), 'hex'))
		.setPayableAmount(amountHbar)
		.execute(client);

	const contractExecuteRx = await contractExecuteTx.getReceipt(client);
	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);

	let contractResults;
	try {
		contractResults = iface.decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	}
	catch (e) {
		if (e.data == '0x') {
			console.log(contractExecuteTx.transactionId.toString(), 'No data returned from contract - check the call');
		}
		else {
			console.log('Error', contractExecuteTx.transactionId.toString(), e);
			console.log(iface.parseError(record.contractFunctionResult.bytes));
		}
	}
	// console.log('Contract Results:', contractResults);
	return [contractExecuteRx, contractResults, record];
}

/**
 * Helper function to create new accounts
 * @param {PrivateKey} privateKey new accounts private key
 * @param {string | number} initialBalance initial balance in hbar
 * @returns {AccountId} the newly created Account ID object
 */
async function accountCreator(privateKey, initialBalance) {
	const response = await new AccountCreateTransaction()
		.setInitialBalance(new Hbar(initialBalance))
		.setMaxAutomaticTokenAssociations(10)
		.setKey(privateKey.publicKey)
		.execute(client);
	const receipt = await response.getReceipt(client);
	return receipt.accountId;
}

async function checkLastMirrorEvent() {
	const url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=desc&limit=1`;

	await axios.get(url)
		.then(function(response) {
			const jsonResponse = response.data;

			jsonResponse.logs.forEach(log => {
				// decode the event data
				if (log.data == '0x') return;
				const event = iface.parseLog({ topics: log.topics, data: log.data });

				let outputStr = 'Block: ' + log.block_number
						+ ' : Tx Hash: ' + log.transaction_hash
						+ ' : Event: ' + event.name + ' : ';

				for (let f = 0; f < event.args.length; f++) {
					const field = event.args[f];

					let output;
					if (typeof field === 'string') {
						output = field.startsWith('0x') ? AccountId.fromSolidityAddress(field).toString() : field;
					}
					else {
						output = field.toString();
					}
					output = f == 0 ? output : ' : ' + output;
					outputStr += output;
				}
				console.log(outputStr);
			});

		})
		.catch(function(err) {
			console.error(err);
			return null;
		});
}

/**
 * Helper function to retrieve account balances
 *
 * NB: This function is deprecated and will have to move to mirror nodes in time
 * @param {AccountId} acctId the account to check
 * @returns {[number, Hbar, number]} balance of the FT token (without decimals), balance of Hbar & NFTs in account as array
 */
async function getAccountBalance(acctId) {

	const query = new AccountInfoQuery()
		.setAccountId(acctId);

	const info = await query.execute(client);

	return info.balance;
}

/**
 * Helper function to send hbar
 * @param {AccountId} sender sender address
 * @param {AccountId} receiver receiver address
 * @param {string | number | BigNumber} amount the amounbt to send
 * @returns {any} expect a string of SUCCESS
 */
async function hbarTransferFcn(sender, receiver, amount) {
	const transferTx = new TransferTransaction()
		.addHbarTransfer(sender, -amount)
		.addHbarTransfer(receiver, amount)
		.freezeWith(client);
	const transferSubmit = await transferTx.execute(client);
	const transferRx = await transferSubmit.getReceipt(client);
	return transferRx.status.toString();
}

/*
 * basci sleep function
 * @param {number} ms milliseconds to sleep
 * @returns {Promise}
 */
// eslint-disable-next-line no-unused-vars
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}