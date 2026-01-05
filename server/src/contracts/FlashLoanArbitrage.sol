// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolAddressesProvider} from "@aave/v3-core/contracts/interfaces/IPoolAddressesProvider.sol";
import {IPool} from "@aave/v3-core/contracts/interfaces/IPool.sol";
import {FlashLoanSimpleReceiverBase} from "@aave/v3-core/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";

/**
 * @title FlashLoanArbitrage
 * @notice Atomic flash loan arbitrage executor for cross-DEX opportunities
 * @dev Implements Aave V3 flash loan receiver for atomic execution
 *
 * Security features:
 * - Onlyowner can execute trades
 * - Reentrancy protection
 * - Slippage protection on all swaps
 * - Profit validation before repayment
 * - Emergency withdrawal function
 */
contract FlashLoanArbitrage is FlashLoanSimpleReceiverBase, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Supported DEX routers
    address public immutable uniswapV3Router;
    address public immutable sushiswapRouter;

    // Minimum profit threshold (in basis points)
    uint256 public minProfitBps = 10; // 0.1% minimum profit

    // Maximum slippage (in basis points)
    uint256 public maxSlippageBps = 150; // 1.5% max slippage

    // Events
    event ArbitrageExecuted(
        address indexed token,
        uint256 amount,
        uint256 profit,
        bytes32 indexed opportunityId
    );
    event MinProfitUpdated(uint256 oldValue, uint256 newValue);
    event MaxSlippageUpdated(uint256 oldValue, uint256 newValue);
    event EmergencyWithdraw(address indexed token, uint256 amount);

    // Errors
    error InsufficientProfit(uint256 expected, uint256 actual);
    error SlippageExceeded(uint256 expected, uint256 actual);
    error InvalidSwapPath();
    error SwapFailed();

    // Swap instruction structure
    struct SwapInstruction {
        address router;       // DEX router address
        address tokenIn;      // Input token
        address tokenOut;     // Output token
        uint256 amountIn;     // Input amount (0 = use balance)
        uint256 minAmountOut; // Minimum output (slippage protection)
        bytes swapData;       // Encoded swap call data
    }

    constructor(
        address _poolProvider,
        address _uniswapV3Router,
        address _sushiswapRouter
    )
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_poolProvider))
        Ownable(msg.sender)
    {
        uniswapV3Router = _uniswapV3Router;
        sushiswapRouter = _sushiswapRouter;
    }

    /**
     * @notice Execute flash loan arbitrage
     * @param token Token to borrow
     * @param amount Amount to borrow
     * @param swapInstructions Encoded swap instructions for arbitrage
     * @param opportunityId Unique identifier for tracking
     */
    function executeArbitrage(
        address token,
        uint256 amount,
        SwapInstruction[] calldata swapInstructions,
        bytes32 opportunityId
    ) external onlyOwner nonReentrant {
        // Encode params for callback
        bytes memory params = abi.encode(swapInstructions, opportunityId);

        // Request flash loan
        POOL.flashLoanSimple(
            address(this),
            token,
            amount,
            params,
            0 // referralCode
        );
    }

    /**
     * @notice Aave flash loan callback
     * @dev This function is called by Aave after receiving the flash loan
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Verify callback is from Aave pool
        require(msg.sender == address(POOL), "Invalid caller");
        require(initiator == address(this), "Invalid initiator");

        // Decode swap instructions
        (SwapInstruction[] memory swapInstructions, bytes32 opportunityId) =
            abi.decode(params, (SwapInstruction[], bytes32));

        // Record starting balance
        uint256 startBalance = IERC20(asset).balanceOf(address(this));

        // Execute all swaps atomically
        for (uint256 i = 0; i < swapInstructions.length; i++) {
            _executeSwap(swapInstructions[i]);
        }

        // Calculate profit
        uint256 endBalance = IERC20(asset).balanceOf(address(this));
        uint256 totalOwed = amount + premium;

        // Verify profit
        if (endBalance < totalOwed) {
            revert InsufficientProfit(totalOwed, endBalance);
        }

        uint256 profit = endBalance - totalOwed;
        uint256 minProfit = (amount * minProfitBps) / 10000;

        if (profit < minProfit) {
            revert InsufficientProfit(minProfit, profit);
        }

        // Approve repayment
        IERC20(asset).safeApprove(address(POOL), totalOwed);

        emit ArbitrageExecuted(asset, amount, profit, opportunityId);

        return true;
    }

    /**
     * @notice Execute a single swap
     * @param instruction Swap instruction to execute
     */
    function _executeSwap(SwapInstruction memory instruction) internal {
        // Determine amount to swap
        uint256 amountIn = instruction.amountIn;
        if (amountIn == 0) {
            amountIn = IERC20(instruction.tokenIn).balanceOf(address(this));
        }

        if (amountIn == 0) {
            revert InvalidSwapPath();
        }

        // Record output token balance before swap
        uint256 balanceBefore = IERC20(instruction.tokenOut).balanceOf(address(this));

        // Approve router to spend input token
        IERC20(instruction.tokenIn).safeApprove(instruction.router, amountIn);

        // Execute swap
        (bool success,) = instruction.router.call(instruction.swapData);
        if (!success) {
            revert SwapFailed();
        }

        // Verify output amount
        uint256 balanceAfter = IERC20(instruction.tokenOut).balanceOf(address(this));
        uint256 amountOut = balanceAfter - balanceBefore;

        if (amountOut < instruction.minAmountOut) {
            revert SlippageExceeded(instruction.minAmountOut, amountOut);
        }

        // Reset approval
        IERC20(instruction.tokenIn).safeApprove(instruction.router, 0);
    }

    /**
     * @notice Build swap data for Uniswap V3 exactInputSingle
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @param fee Pool fee tier
     * @param amountIn Input amount
     * @param minAmountOut Minimum output amount
     */
    function buildUniswapV3SwapData(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 minAmountOut
    ) external view returns (bytes memory) {
        // Use abi.encodeWithSelector for proper struct/tuple encoding
        // Function selector: exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))
        bytes4 selector = 0x414bf389; // Pre-computed selector for exactInputSingle

        // Encode parameters as a tuple (struct is encoded as tuple in ABI)
        return abi.encodePacked(
            selector,
            abi.encode(
                tokenIn,
                tokenOut,
                fee,
                address(this),
                block.timestamp + 300, // 5 minute deadline
                amountIn,
                minAmountOut,
                uint160(0) // sqrtPriceLimitX96 (0 = no limit)
            )
        );
    }

    /**
     * @notice Build swap data for SushiSwap/Uniswap V2 swapExactTokensForTokens
     * @param amountIn Input amount
     * @param minAmountOut Minimum output amount
     * @param path Swap path [tokenIn, tokenOut]
     */
    function buildV2SwapData(
        uint256 amountIn,
        uint256 minAmountOut,
        address[] calldata path
    ) external view returns (bytes memory) {
        return abi.encodeWithSignature(
            "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
            amountIn,
            minAmountOut,
            path,
            address(this),
            block.timestamp + 300 // 5 minute deadline
        );
    }

    /**
     * @notice Update minimum profit threshold
     * @param newMinProfitBps New minimum profit in basis points
     */
    function setMinProfitBps(uint256 newMinProfitBps) external onlyOwner {
        emit MinProfitUpdated(minProfitBps, newMinProfitBps);
        minProfitBps = newMinProfitBps;
    }

    /**
     * @notice Update maximum slippage
     * @param newMaxSlippageBps New max slippage in basis points
     */
    function setMaxSlippageBps(uint256 newMaxSlippageBps) external onlyOwner {
        require(newMaxSlippageBps <= 500, "Slippage too high"); // Max 5%
        emit MaxSlippageUpdated(maxSlippageBps, newMaxSlippageBps);
        maxSlippageBps = newMaxSlippageBps;
    }

    /**
     * @notice Emergency withdraw tokens (in case of stuck funds)
     * @param token Token to withdraw
     * @param amount Amount to withdraw (0 = all)
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 withdrawAmount = amount == 0 ? balance : amount;

        IERC20(token).safeTransfer(owner(), withdrawAmount);

        emit EmergencyWithdraw(token, withdrawAmount);
    }

    /**
     * @notice Emergency withdraw ETH
     */
    function emergencyWithdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool success,) = owner().call{value: balance}("");
        require(success, "ETH transfer failed");

        emit EmergencyWithdraw(address(0), balance);
    }

    /**
     * @notice Calculate minimum output with slippage protection
     * @param expectedOutput Expected output amount
     * @return Minimum acceptable output
     */
    function calculateMinOutput(uint256 expectedOutput) public view returns (uint256) {
        return (expectedOutput * (10000 - maxSlippageBps)) / 10000;
    }

    /**
     * @notice Receive ETH
     */
    receive() external payable {}
}
