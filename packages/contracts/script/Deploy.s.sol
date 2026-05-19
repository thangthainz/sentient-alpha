// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {SentientAgent} from "../src/SentientAgent.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {DecisionLogger} from "../src/DecisionLogger.sol";
import {DexRouter} from "../src/DexRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Deploy is Script {
    address constant ERC8004_IDENTITY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address constant ERC8004_REPUTATION = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;
    address constant MERCHANT_MOE_ROUTER = 0x013e138EF6008ae5FDFDE29700e3f2Bc61d21E3a;
    address constant AGNI_ROUTER = 0x319B69888b0d11cEC22caA5034e25FfFBDc88421;
    address constant USDC = 0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        SentientAgent agent = new SentientAgent(
            ERC8004_IDENTITY,
            ERC8004_REPUTATION,
            "Sentient Alpha",
            "Autonomous AI trading agent: 33-point signal confluence, Bayesian risk, multi-DEX execution on Mantle"
        );

        DecisionLogger logger = new DecisionLogger();

        DexRouter router = new DexRouter(
            MERCHANT_MOE_ROUTER,
            AGNI_ROUTER,
            address(agent)
        );

        StrategyVault vault = new StrategyVault(
            IERC20(USDC),
            "Sentient Alpha Vault",
            "saUSDC",
            address(agent),
            100,  // 1% management fee
            1000  // 10% performance fee
        );

        vm.stopBroadcast();

        console.log("SentientAgent:", address(agent));
        console.log("DecisionLogger:", address(logger));
        console.log("DexRouter:", address(router));
        console.log("StrategyVault:", address(vault));
    }
}
