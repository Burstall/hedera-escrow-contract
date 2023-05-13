const {
	AccountId,
	// eslint-disable-next-line no-unused-vars
	ContractId,
	PrivateKey,
	Client,
	ContractFunctionParameters,
	ContractCreateFlow,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');

require('dotenv').config();
const env = process.env.ENVIRONMENT ?? null;
const contractName = process.env.CONTRACT_NAME ?? null;
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);

let client;

async function main() {
	console.log('Using ENIVRONMENT:', env);

	let walletA, walletB, walletC;
	// get arguments on commnd line
	const args = process.argv.slice(2);
	if (args.length != 3) {
		console.log('usage: node deployEscrow.js <wallet A> <wallet B> <wallet C>');
		console.log('example: node deployEscrow.js 0.0.AAA 0.0.BBB 0.0.CCC');
		console.log('where A is the payer into escrow, B is receive and C is the referee');
		process.exit(1);
	}
	else {
		walletA = AccountId.fromString(args[0]);
		walletB = AccountId.fromString(args[1]);
		walletC = AccountId.fromString(args[2]);
	}

	console.log('Using wallets: A', walletA.toString(), 'B', walletB.toString(), 'C', walletC.toString());

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

	const proceed = readlineSync.keyInYNStrict('Do you want to deploy the contract?');
	if (proceed) {
		const contractId = await contractDeployFcn(walletA, walletB, walletC);
		console.log('Contract deployed successfully', contractId.toString());
	}
	else {
		console.log('Exiting...');
		process.exit(1);
	}
}

/**
 * Helper function to deploy the contract
 * @param {string} bytecode bytecode from compiled SOL file
 * @param {number} gasLim gas limit as a number
 * @returns {ContractId | null} the contract ID or null if failed
 */
async function contractDeployFcn(bytecode, gasLim, walletA, walletB, walletC) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setConstructorParameters(
			new ContractFunctionParameters()
				.addAddress(walletA.toSolidityAddress())
				.addAddress(walletB.toSolidityAddress())
				.addAddress(walletC.toSolidityAddress()),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	return contractCreateRx.contractId;
}

main();