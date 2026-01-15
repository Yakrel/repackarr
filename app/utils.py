import re
import logging
from typing import Optional
from packaging.version import parse as parse_version, Version, InvalidVersion
from guessit import guessit

logger = logging.getLogger("repackarr")

# Common patterns for game versions
VERSION_PATTERNS = [
    r'(?i)v\.?(\d+(\.\d+)+)',       # v1.0.2, v1.5
    r'(?i)update\s?(\d+(\.\d+)*)',  # Update 1.2, Update 5
    r'(?i)patch\s?(\d+(\.\d+)*)',   # Patch 1.3
    r'(?i)build\s?(\d+)',           # Build 1234
    r'(?i)b(\d+)',                  # b1234 (common in some scenes)
]

def extract_version(title: str) -> Optional[str]:
    """
    Attempts to extract a version string from a release title.
    Uses guessit first, then falls back to regex patterns.
    """
    if not title:
        return None
        
    # 1. Try guessit
    parsed = guessit(title)
    if 'version' in parsed:
        # guessit returns version as sensitive info sometimes, ensure string
        return str(parsed['version'])
        
    # 2. Try Regex Patterns
    for pattern in VERSION_PATTERNS:
        match = re.search(pattern, title)
        if match:
            return match.group(1)
            
    return None

def compare_versions(local_ver: str, remote_ver: str) -> int:
    """
    Compares two version strings.
    Returns:
    1  if remote > local
    -1 if remote < local
    0  if equal
    None if comparison failed (invalid format)
    """
    if not local_ver or not remote_ver:
        return None
        
    try:
        v_local = parse_version(local_ver)
        v_remote = parse_version(remote_ver)
        
        # Clean up legacy versions (like "1.0.0.0" matching "1.0") if needed,
        # but packaging.version handles standard PEP440 mostly well.
        
        if v_remote > v_local:
            return 1
        elif v_remote < v_local:
            return -1
        else:
            return 0
    except InvalidVersion:
        logger.debug(f"Version comparison failed for {local_ver} vs {remote_ver}")
        return None
