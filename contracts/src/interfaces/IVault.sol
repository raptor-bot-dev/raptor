// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVault {
    // Events
    event Deposit(address indexed user, uint256 amount, uint256 shares);
    event Withdraw(address indexed user, uint256 amount, uint256 shares);
    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);
    event PositionOpened(address indexed token, uint256 amount, uint256 tokensReceived);
    event PositionClosed(address indexed token, uint256 tokensIn, uint256 nativeOut);

    // View functions
    function totalAssets() external view returns (uint256);
    function totalShares() external view returns (uint256);
    function shareBalance(address user) external view returns (uint256);
    function assetBalance(address user) external view returns (uint256);
    function executor() external view returns (address);
    function router() external view returns (address);

    // User functions
    function deposit() external payable returns (uint256 shares);
    function withdraw(uint256 shares) external returns (uint256 amount);
    function withdrawAll() external returns (uint256 amount);

    // Admin functions
    function setExecutor(address newExecutor) external;
    function pause() external;
    function unpause() external;

    // Executor functions
    function executeBuy(
        address token,
        uint256 amount,
        uint256 minTokensOut
    ) external returns (uint256 tokensReceived);

    function executeSell(
        address token,
        uint256 tokenAmount,
        uint256 minNativeOut
    ) external returns (uint256 nativeReceived);
}
