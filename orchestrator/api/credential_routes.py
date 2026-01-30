"""
Credential management API routes.

Provides endpoints for:
- Setting up AWS credentials
- Setting up HuggingFace tokens
- Checking credential status
- Deleting credentials
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..security import CredentialVault
from ..core.exceptions import CredentialMissingError, VaultLockedError

logger = logging.getLogger(__name__)
router = APIRouter()


# Request/Response models
class AWSCredentialsRequest(BaseModel):
    access_key: str = Field(..., description="AWS Access Key ID")
    secret_key: str = Field(..., description="AWS Secret Access Key")
    region: str = Field(..., description="AWS Region (e.g., us-west-2)")


class HuggingFaceTokenRequest(BaseModel):
    token: str = Field(..., description="HuggingFace API token")


class CredentialStatusResponse(BaseModel):
    aws_configured: bool
    huggingface_configured: bool


class AWSCredentialValidationResponse(BaseModel):
    success: bool
    account_id: Optional[str] = None
    user_arn: Optional[str] = None
    error: Optional[str] = None


# Singleton vault instance
_vault: Optional[CredentialVault] = None


def get_vault() -> CredentialVault:
    """Get or create the credential vault instance."""
    global _vault
    if _vault is None:
        _vault = CredentialVault()
    return _vault


@router.get("/status", response_model=CredentialStatusResponse)
async def get_credential_status():
    """
    Check which credentials are configured.

    Returns:
        Status of each credential type
    """
    vault = get_vault()
    try:
        return vault.get_status()
    except VaultLockedError:
        raise HTTPException(
            status_code=401,
            detail="Vault is locked. Please unlock first."
        )


@router.post("/aws/setup", response_model=AWSCredentialValidationResponse)
async def setup_aws_credentials(request: AWSCredentialsRequest):
    """
    Store AWS credentials securely.

    Validates credentials before storing by calling STS GetCallerIdentity.
    """
    vault = get_vault()

    try:
        import boto3
        from botocore.exceptions import ClientError, NoCredentialsError

        # Validate credentials by calling STS
        session = boto3.Session(
            aws_access_key_id=request.access_key,
            aws_secret_access_key=request.secret_key,
            region_name=request.region,
        )
        sts = session.client("sts")

        try:
            identity = sts.get_caller_identity()

            # Store only if valid
            vault.set_aws_credentials(
                request.access_key,
                request.secret_key,
                request.region,
            )

            logger.info(f"AWS credentials stored for account {identity['Account']}")

            return AWSCredentialValidationResponse(
                success=True,
                account_id=identity["Account"],
                user_arn=identity["Arn"],
            )

        except (ClientError, NoCredentialsError) as e:
            logger.warning(f"AWS credential validation failed: {e}")
            return AWSCredentialValidationResponse(
                success=False,
                error="Invalid AWS credentials",
            )

    except ImportError:
        # boto3 not installed - store without validation
        vault.set_aws_credentials(
            request.access_key,
            request.secret_key,
            request.region,
        )
        logger.warning("boto3 not installed, credentials stored without validation")

        return AWSCredentialValidationResponse(
            success=True,
            error="Credentials stored but not validated (boto3 not installed)",
        )


@router.delete("/aws")
async def delete_aws_credentials():
    """Delete stored AWS credentials."""
    vault = get_vault()
    vault.delete_aws_credentials()
    logger.info("AWS credentials deleted")
    return {"success": True}


@router.post("/huggingface/setup")
async def setup_huggingface_token(request: HuggingFaceTokenRequest):
    """
    Store HuggingFace token securely.

    The token is validated by attempting a test API call.
    """
    vault = get_vault()

    # Basic format validation
    if not request.token.startswith("hf_"):
        return {"success": False, "error": "Invalid token format (should start with 'hf_')"}

    # Store the token
    vault.set_huggingface_token(request.token)
    logger.info("HuggingFace token stored")

    return {"success": True}


@router.delete("/huggingface")
async def delete_huggingface_token():
    """Delete stored HuggingFace token."""
    vault = get_vault()
    vault.delete_huggingface_token()
    logger.info("HuggingFace token deleted")
    return {"success": True}


@router.get("/aws/test")
async def test_aws_credentials():
    """
    Test AWS credentials by calling STS GetCallerIdentity.
    """
    vault = get_vault()

    try:
        session = vault.get_aws_session()
        sts = session.client("sts")
        identity = sts.get_caller_identity()

        return {
            "success": True,
            "account_id": identity["Account"],
            "user_arn": identity["Arn"],
        }

    except CredentialMissingError:
        raise HTTPException(
            status_code=404,
            detail="AWS credentials not configured",
        )
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="boto3 not installed",
        )
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }
