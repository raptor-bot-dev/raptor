// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RaptorVault.sol";

// Mock Router for testing
contract MockRouter {
    address public WETH;

    constructor(address _weth) {
        WETH = _weth;
    }

    function swapExactETHForTokens(
        uint256,
        address[] calldata,
        address,
        uint256
    ) external payable returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = msg.value;
        amounts[1] = msg.value * 1000; // 1000 tokens per native
        return amounts;
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256,
        address[] calldata,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn / 1000; // 1000 tokens per native

        // Send native tokens
        (bool success, ) = to.call{value: amounts[1]}("");
        require(success, "Transfer failed");

        return amounts;
    }

    receive() external payable {}
}

contract MockWETH {
    mapping(address => uint256) public balanceOf;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }
}

contract RaptorVaultTest is Test {
    RaptorVault public vault;
    MockRouter public router;
    MockWETH public weth;

    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    address public executor = address(4);

    function setUp() public {
        vm.startPrank(owner);

        weth = new MockWETH();
        router = new MockRouter(address(weth));

        vault = new RaptorVault(address(router));
        vault.setExecutor(executor);

        vm.stopPrank();

        // Fund accounts
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);
        vm.deal(address(router), 1000 ether);
    }

    function testDeposit() public {
        vm.startPrank(user1);

        uint256 depositAmount = 1 ether;
        uint256 shares = vault.deposit{value: depositAmount}();

        assertEq(shares, depositAmount, "First deposit should get 1:1 shares");
        assertEq(vault.shareBalance(user1), shares, "Share balance should match");
        assertEq(vault.totalShares(), shares, "Total shares should match");
        assertEq(address(vault).balance, depositAmount, "Vault balance should match");

        vm.stopPrank();
    }

    function testMultipleDeposits() public {
        // First deposit
        vm.prank(user1);
        vault.deposit{value: 1 ether}();

        // Second deposit
        vm.prank(user2);
        uint256 shares = vault.deposit{value: 2 ether}();

        assertEq(shares, 2 ether, "Second deposit should get proportional shares");
        assertEq(vault.totalShares(), 3 ether, "Total shares should be sum");
        assertEq(address(vault).balance, 3 ether, "Vault balance should be sum");
    }

    function testWithdraw() public {
        vm.startPrank(user1);

        vault.deposit{value: 1 ether}();
        uint256 shares = vault.shareBalance(user1);

        uint256 balanceBefore = user1.balance;
        uint256 amount = vault.withdraw(shares);

        assertEq(amount, 1 ether, "Should withdraw full amount");
        assertEq(user1.balance, balanceBefore + amount, "Balance should increase");
        assertEq(vault.shareBalance(user1), 0, "Shares should be zero");
        assertEq(vault.totalShares(), 0, "Total shares should be zero");

        vm.stopPrank();
    }

    function testWithdrawAll() public {
        vm.startPrank(user1);

        vault.deposit{value: 5 ether}();

        uint256 balanceBefore = user1.balance;
        uint256 amount = vault.withdrawAll();

        assertEq(amount, 5 ether, "Should withdraw all");
        assertEq(user1.balance, balanceBefore + amount, "Balance should increase");
        assertEq(vault.shareBalance(user1), 0, "Shares should be zero");

        vm.stopPrank();
    }

    function testMinimumDeposit() public {
        vm.startPrank(user1);

        vm.expectRevert("Below minimum deposit");
        vault.deposit{value: 0.001 ether}();

        vm.stopPrank();
    }

    function testPauseDeposit() public {
        vm.prank(owner);
        vault.pause();

        vm.startPrank(user1);
        vm.expectRevert("Paused");
        vault.deposit{value: 1 ether}();
        vm.stopPrank();
    }

    function testPauseWithdraw() public {
        vm.startPrank(user1);
        vault.deposit{value: 1 ether}();
        uint256 shares = vault.shareBalance(user1);
        vm.stopPrank();

        vm.prank(owner);
        vault.pause();

        vm.prank(user1);
        vm.expectRevert("Paused");
        vault.withdraw(shares);
    }

    function testSetExecutor() public {
        address newExecutor = address(5);

        vm.prank(owner);
        vault.setExecutor(newExecutor);

        assertEq(vault.executor(), newExecutor, "Executor should be updated");
    }

    function testOnlyOwnerCanSetExecutor() public {
        vm.startPrank(user1);
        vm.expectRevert("Not owner");
        vault.setExecutor(user1);
        vm.stopPrank();
    }

    function testAssetBalance() public {
        vm.prank(user1);
        vault.deposit{value: 1 ether}();

        vm.prank(user2);
        vault.deposit{value: 1 ether}();

        assertEq(vault.assetBalance(user1), 1 ether, "User1 should have 1 ETH equivalent");
        assertEq(vault.assetBalance(user2), 1 ether, "User2 should have 1 ETH equivalent");
    }

    function testSharesValueAfterProfit() public {
        vm.prank(user1);
        vault.deposit{value: 1 ether}();

        // Simulate profit by sending ETH to vault
        vm.deal(address(vault), 2 ether);

        assertEq(vault.assetBalance(user1), 2 ether, "User1 should have 2 ETH equivalent after profit");
    }

    function testFuzz_Deposit(uint256 amount) public {
        amount = bound(amount, 0.01 ether, 100 ether);
        vm.deal(user1, amount);

        vm.prank(user1);
        uint256 shares = vault.deposit{value: amount}();

        assertEq(shares, amount, "Shares should equal deposit for first depositor");
    }
}
