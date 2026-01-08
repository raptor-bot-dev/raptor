// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IVault.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IRouter {
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function WETH() external pure returns (address);
}

/**
 * @title RaptorVault
 * @notice Pooled vault for collective MEV hunting
 * @dev Users deposit native tokens (BNB/ETH), receive shares, and share in profits
 */
contract RaptorVault is IVault {
    // State
    address public override executor;
    address public immutable override router;
    address public immutable wrappedNative;
    address public owner;

    uint256 public override totalShares;
    uint256 private _totalAssets;
    bool public paused;

    mapping(address => uint256) public override shareBalance;

    // Constants
    uint256 private constant PRECISION = 1e18;
    uint256 private constant MIN_DEPOSIT = 0.01 ether;

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyExecutor() {
        require(msg.sender == executor, "Not executor");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(address _router) {
        owner = msg.sender;
        executor = msg.sender;
        router = _router;
        wrappedNative = IRouter(_router).WETH();
    }

    // View functions
    function totalAssets() public view override returns (uint256) {
        return address(this).balance;
    }

    function assetBalance(address user) public view override returns (uint256) {
        if (totalShares == 0) return 0;
        return (shareBalance[user] * totalAssets()) / totalShares;
    }

    function sharesToAssets(uint256 shares) public view returns (uint256) {
        if (totalShares == 0) return shares;
        return (shares * totalAssets()) / totalShares;
    }

    function assetsToShares(uint256 assets) public view returns (uint256) {
        if (totalShares == 0 || totalAssets() == 0) return assets;
        return (assets * totalShares) / totalAssets();
    }

    // User functions
    function deposit() external payable override whenNotPaused returns (uint256 shares) {
        require(msg.value >= MIN_DEPOSIT, "Below minimum deposit");

        if (totalShares == 0) {
            shares = msg.value;
        } else {
            // Calculate shares based on current ratio
            shares = (msg.value * totalShares) / (totalAssets() - msg.value);
        }

        require(shares > 0, "Zero shares");

        shareBalance[msg.sender] += shares;
        totalShares += shares;

        emit Deposit(msg.sender, msg.value, shares);
    }

    function withdraw(uint256 shares) external override whenNotPaused returns (uint256 amount) {
        require(shares > 0, "Zero shares");
        require(shareBalance[msg.sender] >= shares, "Insufficient shares");

        amount = sharesToAssets(shares);
        require(amount > 0, "Zero amount");
        require(address(this).balance >= amount, "Insufficient balance");

        shareBalance[msg.sender] -= shares;
        totalShares -= shares;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdraw(msg.sender, amount, shares);
    }

    function withdrawAll() external override whenNotPaused returns (uint256 amount) {
        uint256 shares = shareBalance[msg.sender];
        require(shares > 0, "No shares");

        amount = sharesToAssets(shares);
        require(amount > 0, "Zero amount");
        require(address(this).balance >= amount, "Insufficient balance");

        shareBalance[msg.sender] = 0;
        totalShares -= shares;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdraw(msg.sender, amount, shares);
    }

    // Executor functions
    function executeBuy(
        address token,
        uint256 amount,
        uint256 minTokensOut
    ) external override onlyExecutor whenNotPaused returns (uint256 tokensReceived) {
        require(amount <= address(this).balance, "Insufficient balance");

        address[] memory path = new address[](2);
        path[0] = wrappedNative;
        path[1] = token;

        uint256[] memory amounts = IRouter(router).swapExactETHForTokens{value: amount}(
            minTokensOut,
            path,
            address(this),
            block.timestamp + 300
        );

        tokensReceived = amounts[1];
        emit PositionOpened(token, amount, tokensReceived);
    }

    function executeSell(
        address token,
        uint256 tokenAmount,
        uint256 minNativeOut
    ) external override onlyExecutor whenNotPaused returns (uint256 nativeReceived) {
        IERC20(token).approve(router, tokenAmount);

        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = wrappedNative;

        uint256 balanceBefore = address(this).balance;

        uint256[] memory amounts = IRouter(router).swapExactTokensForETH(
            tokenAmount,
            minNativeOut,
            path,
            address(this),
            block.timestamp + 300
        );

        nativeReceived = amounts[1];
        emit PositionClosed(token, tokenAmount, nativeReceived);
    }

    // Admin functions
    function setExecutor(address newExecutor) external override onlyOwner {
        require(newExecutor != address(0), "Zero address");
        address oldExecutor = executor;
        executor = newExecutor;
        emit ExecutorUpdated(oldExecutor, newExecutor);
    }

    function pause() external override onlyOwner {
        paused = true;
    }

    function unpause() external override onlyOwner {
        paused = false;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // Emergency functions
    function emergencyWithdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }

    function emergencyWithdrawNative(uint256 amount) external onlyOwner {
        require(paused, "Must be paused");
        (bool success, ) = owner.call{value: amount}("");
        require(success, "Transfer failed");
    }

    // Receive native tokens
    receive() external payable {}
}
