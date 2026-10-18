// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title What CredentialRegistry needs to know about an institution.
interface IInstitutionRegistry {
    function isActive(address institution) external view returns (bool);
}
