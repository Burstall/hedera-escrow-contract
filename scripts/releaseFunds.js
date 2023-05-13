const {
	AccountId,
	ContractId,
	PrivateKey,
	ContractExecuteTransaction,
	Client,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');

require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const env = process.env.ENVIRONMENT ?? null;
const contractName = process.env.CONTRACT_NAME ?? null;
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);

let abi, iface, client;

async function main() {
	console.log('Using ENIVRONMENT:', env);

	if (env === undefined || env == null) {
		console.log('Environment required, please specify TEST or MAIN in the .env file');
		return;
	}

	if (contractName === undefined || contractName == null) {
		console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
		return;
	}

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('execution in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('execution in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	console.log('Using Operator:', operatorId.toString());

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	abi = json.abi;

	iface = new ethers.utils.Interface(abi);

	let contractId = null;
	// get arguments on commnd line
	const args = process.argv.slice(2);
	// check only one argument is supplied at command line
	if (args.length == 1) {
		contractId = ContractId.fromString(args[0]);
	}
	else {
		contractId = ContractId.fromString(process.env.CONTRACT_ID);
	}

	if (contractId == null) {
		console.log('ContractId required, please specify CONTRACT_ID in the .env file or as an argument');
		process.exit(1);
	}

	const proceed = readlineSync.keyInYNStrict('Do you want to release funds?');

	if (proceed) {
		const [contractResults] = await contractExecuteFcn(contractId, 200_000, 'release', []);
		console.log('Contract Results:', contractResults.status.toString());
	}
	else {
		console.log('Aborting');
	}
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
	// console.log('Calling', fcnName, 'with params', params);
	const encodedCommand = iface.encodeFunctionData(fcnName, params);
	// console.log('Encoded command:', encodedCommand);
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


main();