# Escrow Contract

Two parties engage in a work contract, using escrow and a trusted third party as referee to break ties.

A - commissions work, requests platform to deploy a contract (or indeed self serve), pays the funds in
B - before doing work checks the deployed contract isFunded(). 
C - platform owner (trusted 3rd party to both A & B) can call unwind() sending funds back to A 

# Deployment
Single shot deployment for POC. Move to an EscrowFactory for live usage.

Immutable variables set in the constructor for wallets A/B/C.

[A more advanced version could use OpenZepplin Role Control to define the admin role across multiple wallets - ideally a single multiSig wallet acts as admin to add a higher trust threshold]

# Funding
Funding via a Solidity call allowing events to be emitted for the Front End

[Recieve method does not trigger from an HTS transfer]

# Release
If A calls it then B is paid
If C calls it then A is paid


----
ensure you create a .env (use .env.example as template) to specify account/key/envrionment (MAIN/TEST)

# setup
npm install
npx hardhat compile
^^ not needed to run test suites

# test
npm hardhat test

# deploy
node scripts/deployEscrow.js 0.0.AAAA 0.0.BBBB 0.0.CCCC

[update the contractID in the .env file]

# fund
node scripts/fundEscrow.js amt

where amt is the number of hbar to fund

# release
node scripts/releaseFunds.js

# get contract logs
node scripts/getContractLogs.js 0.0.XXXX

either specify the contract ID on the command line or in .env file (you will need to specify the contract name in .env)