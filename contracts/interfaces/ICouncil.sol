// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Read-only view of the governance council used by the registries.
interface ICouncil {
    function isGovernor(address account) external view returns (bool);
    function quorum() external view returns (uint8);
}
