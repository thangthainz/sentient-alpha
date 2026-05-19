// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract DecisionLogger is Ownable {
    struct Decision {
        uint64 timestamp;
        bytes32 pairHash;
        uint8 action;       // 0=ENTRY, 1=EXIT, 2=SKIP, 3=ADJUST
        uint8 setupType;    // 0=TREND_PULLBACK, 1=LIQUIDITY_SWEEP, 2=VOL_EXPANSION
        uint16 scoreBps;    // signal score * 100 (e.g. 2850 = 28.5/33)
        int64 pnlBps;       // realized PnL in bps (for exits)
        bytes32 reasonHash; // keccak256 of reason string
    }

    Decision[] public decisions;
    mapping(bytes32 => uint256[]) public pairDecisions;

    uint256 public totalEntries;
    uint256 public totalExits;
    uint256 public totalSkips;
    int256 public netPnlBps;

    event DecisionRecorded(
        uint256 indexed id,
        bytes32 indexed pairHash,
        uint8 action,
        uint8 setupType,
        uint16 scoreBps,
        int64 pnlBps
    );

    constructor() Ownable(msg.sender) {}

    function logDecision(
        bytes32 pairHash,
        uint8 action,
        uint8 setupType,
        uint16 scoreBps,
        int64 pnlBps,
        bytes32 reasonHash
    ) external onlyOwner {
        uint256 id = decisions.length;
        decisions.push(Decision({
            timestamp: uint64(block.timestamp),
            pairHash: pairHash,
            action: action,
            setupType: setupType,
            scoreBps: scoreBps,
            pnlBps: pnlBps,
            reasonHash: reasonHash
        }));
        pairDecisions[pairHash].push(id);

        if (action == 0) totalEntries++;
        else if (action == 1) { totalExits++; netPnlBps += pnlBps; }
        else if (action == 2) totalSkips++;

        emit DecisionRecorded(id, pairHash, action, setupType, scoreBps, pnlBps);
    }

    function getDecision(uint256 id) external view returns (Decision memory) {
        return decisions[id];
    }

    function getDecisionCount() external view returns (uint256) {
        return decisions.length;
    }

    function getPairDecisionIds(bytes32 pairHash) external view returns (uint256[] memory) {
        return pairDecisions[pairHash];
    }

    function getRecentDecisions(uint256 count) external view returns (Decision[] memory) {
        uint256 total = decisions.length;
        uint256 start = total > count ? total - count : 0;
        Decision[] memory recent = new Decision[](total - start);
        for (uint256 i = start; i < total; i++) {
            recent[i - start] = decisions[i];
        }
        return recent;
    }
}
