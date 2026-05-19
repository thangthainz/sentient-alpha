// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IIdentityRegistry {
    function registerAgent(bytes32 agentId, string calldata metadata) external;
}

interface IReputationRegistry {
    function reportAction(bytes32 agentId, uint8 actionType, int64 score) external;
}

contract SentientAgent is Ownable {
    IIdentityRegistry public immutable identityRegistry;
    IReputationRegistry public immutable reputationRegistry;

    bytes32 public agentId;
    bool public registered;

    string public name;
    string public strategyDescription;
    uint256 public registeredAt;

    uint256 public totalDecisions;
    uint256 public totalTrades;
    int256 public cumulativePnlBps;

    event AgentRegistered(bytes32 indexed agentId, string name);
    event DecisionLogged(uint256 indexed decisionId, string action, int256 scoreBps);
    event ReputationReported(bytes32 indexed agentId, int64 score);

    constructor(
        address _identityRegistry,
        address _reputationRegistry,
        string memory _name,
        string memory _strategyDescription
    ) Ownable(msg.sender) {
        identityRegistry = IIdentityRegistry(_identityRegistry);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
        name = _name;
        strategyDescription = _strategyDescription;
    }

    function register(string calldata metadata) external onlyOwner {
        require(!registered, "already registered");
        agentId = keccak256(abi.encodePacked(address(this), block.chainid, block.timestamp));
        identityRegistry.registerAgent(agentId, metadata);
        registered = true;
        registeredAt = block.timestamp;
        emit AgentRegistered(agentId, name);
    }

    function logDecision(string calldata action, int256 scoreBps) external onlyOwner {
        totalDecisions++;
        cumulativePnlBps += scoreBps;
        emit DecisionLogged(totalDecisions, action, scoreBps);
    }

    function recordTrade(int256 pnlBps) external onlyOwner {
        totalTrades++;
        cumulativePnlBps += pnlBps;
    }

    function reportReputation(int64 score) external onlyOwner {
        require(registered, "not registered");
        reputationRegistry.reportAction(agentId, 1, score);
        emit ReputationReported(agentId, score);
    }

    function getStats() external view returns (
        uint256 decisions,
        uint256 trades,
        int256 pnlBps,
        uint256 regTime
    ) {
        return (totalDecisions, totalTrades, cumulativePnlBps, registeredAt);
    }
}
