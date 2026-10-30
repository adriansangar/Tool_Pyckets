import httpx
import hmac
import hashlib
from typing import List, Dict, Any, Optional

GITHUB_API_URL = "https://api.github.com"

def get_github_headers(token: Optional[str] = None) -> Dict[str, str]:
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Pyckets-App"
    }
    if token and token.strip():
        headers["Authorization"] = f"Bearer {token.strip()}"
    return headers

def verify_webhook_signature(payload_body: bytes, secret: str, signature_header: Optional[str]) -> bool:
    if not signature_header or not secret:
        return False
    hash_type, signature = signature_header.split('=') if '=' in signature_header else ('', '')
    if hash_type != 'sha256':
        return False
    mac = hmac.new(secret.encode('utf-8'), msg=payload_body, digestmod=hashlib.sha256)
    return hmac.compare_digest(mac.hexdigest(), signature)

async def verify_repo_access(owner: str, repo: str, token: Optional[str] = None) -> Dict[str, Any]:
    headers = get_github_headers(token)
    async with httpx.AsyncClient() as client:
        url = f"{GITHUB_API_URL}/repos/{owner}/{repo}"
        response = await client.get(url, headers=headers)
        if response.status_code == 200:
            return {"valid": True, "error": None}
        elif response.status_code in (403, 429):
            return {"valid": False, "error": "Límite de peticiones de GitHub alcanzado (Rate Limit)"}
        elif response.status_code == 404:
            return {"valid": False, "error": "Repositorio no encontrado o privado (requiere token)"}
        return {"valid": False, "error": f"Error GitHub HTTP {response.status_code}"}

async def fetch_repo_commits(owner: str, repo: str, token: Optional[str] = None) -> List[Dict[str, Any]]:
    headers = get_github_headers(token)
    async with httpx.AsyncClient() as client:
        url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/commits"
        response = await client.get(url, headers=headers, params={"per_page": 30})
        if response.status_code == 200:
            return response.json()
        return []

async def fetch_repo_pulls(owner: str, repo: str, token: Optional[str] = None) -> List[Dict[str, Any]]:
    headers = get_github_headers(token)
    async with httpx.AsyncClient() as client:
        url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/pulls"
        response = await client.get(url, headers=headers, params={"state": "all", "per_page": 30})
        if response.status_code == 200:
            return response.json()
        return []