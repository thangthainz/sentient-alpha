// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMerchantMoeLBRouter {
    struct Path {
        uint256[] pairBinSteps;
        uint8[] versions;
        IERC20[] tokenPath;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Path memory path,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut);
}

interface IAgniSwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

contract DexRouter is Ownable {
    using SafeERC20 for IERC20;

    IMerchantMoeLBRouter public immutable merchantMoe;
    IAgniSwapRouter public immutable agniFinance;

    uint256 public constant MAX_SLIPPAGE_BPS = 500;
    uint256 public constant BPS = 10000;

    address public agent;

    event SwapExecuted(
        address indexed dex,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    modifier onlyAgent() {
        require(msg.sender == agent || msg.sender == owner(), "not authorized");
        _;
    }

    constructor(
        address _merchantMoe,
        address _agniFinance,
        address _agent
    ) Ownable(msg.sender) {
        merchantMoe = IMerchantMoeLBRouter(_merchantMoe);
        agniFinance = IAgniSwapRouter(_agniFinance);
        agent = _agent;
    }

    function swapMerchantMoe(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 binStep
    ) external onlyAgent returns (uint256) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(merchantMoe), amountIn);

        IERC20[] memory tokenPath = new IERC20[](2);
        tokenPath[0] = IERC20(tokenIn);
        tokenPath[1] = IERC20(tokenOut);

        uint256[] memory pairBinSteps = new uint256[](1);
        pairBinSteps[0] = binStep;

        uint8[] memory versions = new uint8[](1);
        versions[0] = 2; // LB V2.1

        IMerchantMoeLBRouter.Path memory path = IMerchantMoeLBRouter.Path({
            pairBinSteps: pairBinSteps,
            versions: versions,
            tokenPath: tokenPath
        });

        uint256 amountOut = merchantMoe.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            msg.sender,
            block.timestamp + 300
        );

        emit SwapExecuted(address(merchantMoe), tokenIn, tokenOut, amountIn, amountOut);
        return amountOut;
    }

    function swapAgni(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint24 fee
    ) external onlyAgent returns (uint256) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(agniFinance), amountIn);

        uint256 amountOut = agniFinance.exactInputSingle(
            IAgniSwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: amountOutMin,
                sqrtPriceLimitX96: 0
            })
        );

        emit SwapExecuted(address(agniFinance), tokenIn, tokenOut, amountIn, amountOut);
        return amountOut;
    }

    function setAgent(address _agent) external onlyOwner {
        agent = _agent;
    }

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
}
