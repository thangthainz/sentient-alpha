import { ethers } from "ethers";
import type { TradeOrder, OrderSide } from "@sentient-alpha/shared";
import { MANTLE_CONTRACTS, DEX, ENGINE } from "@sentient-alpha/shared";

const MERCHANT_MOE_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256 amountOut)",
  "function getSwapOut(address pair, uint128 amountIn, bool swapForY) view returns (uint128 amountInLeft, uint128 amountOut, uint128 fee)",
];

const AGNI_ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
];

const AGNI_QUOTER_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export class DexExecutor {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private merchantMoe: ethers.Contract;
  private agniRouter: ethers.Contract;
  private agniQuoter: ethers.Contract;

  constructor(rpcUrl: string, privateKey: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.merchantMoe = new ethers.Contract(DEX.MERCHANT_MOE.LB_ROUTER, MERCHANT_MOE_ABI, this.wallet);
    this.agniRouter = new ethers.Contract(DEX.AGNI_FINANCE.SWAP_ROUTER, AGNI_ROUTER_ABI, this.wallet);
    this.agniQuoter = new ethers.Contract(DEX.AGNI_FINANCE.QUOTER_V2, AGNI_QUOTER_ABI, this.provider);
  }

  async getBalance(token: string): Promise<bigint> {
    const erc20 = new ethers.Contract(token, ERC20_ABI, this.provider);
    return erc20.balanceOf(this.wallet.address);
  }

  async getDecimals(token: string): Promise<number> {
    const erc20 = new ethers.Contract(token, ERC20_ABI, this.provider);
    return erc20.decimals();
  }

  async quoteAgni(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    fee = 3000
  ): Promise<bigint> {
    const [amountOut] = await this.agniQuoter.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0n,
    });
    return amountOut;
  }

  async swapAgni(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    slippageBps: number = ENGINE.SLIPPAGE_BPS,
    fee = 3000
  ): Promise<TradeOrder> {
    const id = `agni-${Date.now()}`;
    const order: TradeOrder = {
      id,
      pair: `${tokenIn}/${tokenOut}`,
      side: "BUY",
      amount: amountIn,
      expectedPrice: 0,
      slippageBps,
      dex: "agni_finance",
      status: "PENDING",
      timestamp: Date.now(),
    };

    try {
      await this.ensureApproval(tokenIn, DEX.AGNI_FINANCE.SWAP_ROUTER, amountIn);

      const quote = await this.quoteAgni(tokenIn, tokenOut, amountIn, fee);
      const minOut = quote * BigInt(10000 - slippageBps) / 10000n;

      const tx = await this.agniRouter.exactInputSingle({
        tokenIn,
        tokenOut,
        fee,
        recipient: this.wallet.address,
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      });

      const receipt = await tx.wait();
      order.txHash = receipt.hash;
      order.gasUsed = receipt.gasUsed;
      order.status = "FILLED";
    } catch (err: any) {
      order.status = "FAILED";
      console.error(`[DEX] Agni swap failed: ${err.message}`);
    }

    return order;
  }

  async swapMerchantMoe(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    slippageBps: number = ENGINE.SLIPPAGE_BPS,
    binStep = 20
  ): Promise<TradeOrder> {
    const id = `moe-${Date.now()}`;
    const order: TradeOrder = {
      id,
      pair: `${tokenIn}/${tokenOut}`,
      side: "BUY",
      amount: amountIn,
      expectedPrice: 0,
      slippageBps,
      dex: "merchant_moe",
      status: "PENDING",
      timestamp: Date.now(),
    };

    try {
      await this.ensureApproval(tokenIn, DEX.MERCHANT_MOE.LB_ROUTER, amountIn);

      const tx = await this.merchantMoe.swapExactTokensForTokens(
        amountIn,
        0n,
        {
          pairBinSteps: [binStep],
          versions: [2],
          tokenPath: [tokenIn, tokenOut],
        },
        this.wallet.address,
        BigInt(Math.floor(Date.now() / 1000) + 300)
      );

      const receipt = await tx.wait();
      order.txHash = receipt.hash;
      order.gasUsed = receipt.gasUsed;
      order.status = "FILLED";
    } catch (err: any) {
      order.status = "FAILED";
      console.error(`[DEX] MerchantMoe swap failed: ${err.message}`);
    }

    return order;
  }

  private async ensureApproval(token: string, spender: string, amount: bigint): Promise<void> {
    const erc20 = new ethers.Contract(token, ERC20_ABI, this.wallet);
    const currentAllowance = await erc20.allowance(this.wallet.address, spender);
    if (currentAllowance < amount) {
      const tx = await erc20.approve(spender, ethers.MaxUint256);
      await tx.wait();
    }
  }

  getWalletAddress(): string {
    return this.wallet.address;
  }
}
