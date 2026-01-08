// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IVault.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

/**
 * @title ExecutionEngine
 * @notice On-chain execution helper for MEV hunting
 * @dev Provides batched execution and MEV protection
 */
contract ExecutionEngine {
    // State
    address public owner;
    address public vault;
    mapping(address => bool) public operators;
    mapping(address => bool) public blacklistedTokens;

    // Events
    event OperatorUpdated(address indexed operator, bool status);
    event TokenBlacklisted(address indexed token, bool status);
    event VaultUpdated(address indexed oldVault, address indexed newVault);
    event BatchExecuted(uint256 buys, uint256 sells);

    // Structs
    struct BuyOrder {
        address token;
        uint256 amount;
        uint256 minTokensOut;
    }

    struct SellOrder {
        address token;
        uint256 tokenAmount;
        uint256 minNativeOut;
    }

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOperator() {
        require(operators[msg.sender] || msg.sender == owner, "Not operator");
        _;
    }

    constructor(address _vault) {
        owner = msg.sender;
        vault = _vault;
        operators[msg.sender] = true;
    }

    // Execution functions
    function executeBuy(
        address token,
        uint256 amount,
        uint256 minTokensOut
    ) external onlyOperator returns (uint256) {
        require(!blacklistedTokens[token], "Token blacklisted");
        return IVault(vault).executeBuy(token, amount, minTokensOut);
    }

    function executeSell(
        address token,
        uint256 tokenAmount,
        uint256 minNativeOut
    ) external onlyOperator returns (uint256) {
        return IVault(vault).executeSell(token, tokenAmount, minNativeOut);
    }

    function batchExecute(
        BuyOrder[] calldata buys,
        SellOrder[] calldata sells
    ) external onlyOperator {
        // Execute sells first (to free up capital)
        for (uint256 i = 0; i < sells.length; i++) {
            try IVault(vault).executeSell(
                sells[i].token,
                sells[i].tokenAmount,
                sells[i].minNativeOut
            ) {} catch {}
        }

        // Execute buys
        for (uint256 i = 0; i < buys.length; i++) {
            if (blacklistedTokens[buys[i].token]) continue;
            try IVault(vault).executeBuy(
                buys[i].token,
                buys[i].amount,
                buys[i].minTokensOut
            ) {} catch {}
        }

        emit BatchExecuted(buys.length, sells.length);
    }

    // Admin functions
    function setOperator(address operator, bool status) external onlyOwner {
        operators[operator] = status;
        emit OperatorUpdated(operator, status);
    }

    function setTokenBlacklist(address token, bool status) external onlyOwner {
        blacklistedTokens[token] = status;
        emit TokenBlacklisted(token, status);
    }

    function setVault(address newVault) external onlyOwner {
        require(newVault != address(0), "Zero address");
        address oldVault = vault;
        vault = newVault;
        emit VaultUpdated(oldVault, newVault);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // View functions
    function getTokenInfo(address token) external view returns (
        uint256 balance,
        uint8 decimals,
        string memory symbol
    ) {
        try IERC20(token).balanceOf(vault) returns (uint256 bal) {
            balance = bal;
        } catch {}

        try IERC20(token).decimals() returns (uint8 dec) {
            decimals = dec;
        } catch {
            decimals = 18;
        }

        try IERC20(token).symbol() returns (string memory sym) {
            symbol = sym;
        } catch {
            symbol = "UNKNOWN";
        }
    }
}
