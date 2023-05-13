// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.5.8 <0.9.0;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";

contract EscrowContract {

	// Parties involved in the escrow
	address private immutable _commisioner;
	address private immutable _worker;
	address private immutable _referee;

	// Events to help monitor state changes
	event EscrowCreateEvent (
		address indexed _commisioner,
		address indexed _worker,
		address indexed _referee
	);

	event EscrowFundedEvent (
		address indexed _commisioner,
		uint256 _amount
	);

	event EscrowReleasedEvent (
		address indexed _aggressor,
		address indexed _reciever,
		uint256 _amount
	);

	// Custom errors
	error Unauthorized();
	error NoFunds();

	constructor(address commisioner, address worker, address referee) {
		_commisioner = commisioner;
		_worker = worker;
		_referee = referee;
		emit EscrowCreateEvent(_commisioner, _worker, _referee);
	}

	function fundEscrow() external payable {
		if (msg.sender != _commisioner) revert Unauthorized();
		emit EscrowFundedEvent(
			msg.sender,
			msg.value
		);
	}

	function release() external {
		// only the commisioner or the referee can release the funds
		if (msg.sender != _commisioner || msg.sender != _referee) revert Unauthorized();
		uint256 balance = address(this).balance;
		if (balance == 0) revert NoFunds();

		address payable receiverAddress;
		if (msg.sender == _commisioner) {
			receiverAddress = payable(_worker);
		} else {
			receiverAddress = payable(_commisioner);
		}

		// transfer the funds
		Address.sendValue(receiverAddress, balance);
		emit EscrowReleasedEvent(msg.sender, receiverAddress, balance);
	}
	
	// method to check if the contract has been funded
	// can simply query mirror node too
	function isFunded() external view returns (uint balance) {
		return address(this).balance;
	}

	// retrieve the associated wallets
	function getParties() external view returns (address commisioner, address worker, address referee) {
		return (_commisioner, _worker, _referee);
	}

	// allow the contract to receive funds vis HTS
	receive() external payable {
        emit EscrowFundedEvent(
            msg.sender,
            msg.value
        );
    }

    fallback() external payable {
         emit EscrowFundedEvent(
            msg.sender,
            msg.value
        );
    }
}