import httpx
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

async def verify_repo_access(owner: str, repo: str, token: Optional[str] = None) -> bool:
    headers = get_github_headers(token)
    async with httpx.AsyncClient() as client:
        url = f"{GITHUB_API_URL}/repos/{owner}/{repo}"
        response = await client.get(url, headers=headers)
        return response.status_code == 200

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