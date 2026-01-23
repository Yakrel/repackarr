"""
Utility functions for version parsing and comparison.
"""
import re
import logging
from typing import Optional
from packaging.version import parse as parse_version, InvalidVersion
from guessit import guessit

logger = logging.getLogger("repackarr")

# Common patterns for game versions (ordered by specificity)
VERSION_PATTERNS = [
    r'(?i)v\.?\s*(\d+(?:\.\d+)*)',           # v1.0.2, v5, v 10, v.1.0
    r'(?i)version\s*(\d+(?:\.\d+)*)',        # version 1.0.2, version 5
    r'(?i)update\s*(\d+(?:\.\d+)*)',         # Update 1.2, Update 5  
    r'(?i)patch\s*(\d+(?:\.\d+)*)',          # Patch 1.3
    r'(?i)build[\s._-]?(\d{4,})',            # Build 1234, build.5678
    r'(?i)(?:^|[.\-_\s])b(\d{4,})(?:$|[.\-_\s])',  # b1234 (scene builds)
    r'(?i)gog[\s._-]?(\d+(?:\.\d+)*)',       # GOG version numbers
]


def extract_version(title: str) -> Optional[str]:
    """
    Extract a version string from a release title.
    
    Uses guessit library first for common media patterns,
    then falls back to custom regex patterns for game-specific versioning.
    
    Args:
        title: Release title to parse
        
    Returns:
        Version string if found, None otherwise
        
    Examples:
        >>> extract_version("Game Name v1.2.3")
        '1.2.3'
        >>> extract_version("Game Name Update 5")
        '5'
        >>> extract_version("Game Name Build 12345")
        '12345'
    """
    if not title or not title.strip():
        return None
    
    title = title.strip()
    
    # 1. Try guessit for standard media version detection
    try:
        parsed = guessit(title)
        if 'version' in parsed:
            return str(parsed['version'])
    except Exception as e:
        logger.debug(f"Guessit parsing failed for '{title}': {e}")
        
    # 2. Try custom regex patterns
    for pattern in VERSION_PATTERNS:
        match = re.search(pattern, title)
        if match:
            version = match.group(1)
            # Normalize version string
            return version.strip()
            
    return None


def normalize_version(version: str) -> str:
    """
    Normalize a version string for consistent comparison.
    
    Args:
        version: Raw version string
        
    Returns:
        Normalized version string
    """
    if not version:
        return ""
    
    # Remove common prefixes
    version = re.sub(r'^[vV]\.?\s*', '', version)
    # Remove trailing zeros after major version (1.0.0 -> 1.0)
    # But keep meaningful zeros (1.0.1 stays 1.0.1)
    return version.strip()


def compare_versions(local_ver: str, remote_ver: str) -> Optional[int]:
    """
    Compare two version strings.
    
    Args:
        local_ver: Currently installed version
        remote_ver: Remote/available version
        
    Returns:
        1  if remote > local (upgrade available)
        -1 if remote < local (downgrade)
        0  if versions are equal
        None if comparison failed (invalid format)
        
    Examples:
        >>> compare_versions("1.0", "1.1")
        1
        >>> compare_versions("2.0", "1.5")
        -1
        >>> compare_versions("1.0.0", "1.0.0")
        0
    """
    if not local_ver or not remote_ver:
        return None
    
    # Normalize versions
    local_ver = normalize_version(local_ver)
    remote_ver = normalize_version(remote_ver)
        
    try:
        v_local = parse_version(local_ver)
        v_remote = parse_version(remote_ver)
        
        if v_remote > v_local:
            return 1
        elif v_remote < v_local:
            return -1
        else:
            return 0
    except InvalidVersion:
        logger.debug(f"Version comparison failed for '{local_ver}' vs '{remote_ver}'")
        return None


def format_size(size_bytes: int) -> str:
    """
    Format byte size to human-readable string.
    
    Args:
        size_bytes: Size in bytes
        
    Returns:
        Formatted size string (e.g., "1.5 GB")
    """
    if size_bytes <= 0:
        return "?"
    
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    size = float(size_bytes)
    
    for unit in units:
        if size < 1024.0:
            if unit == 'B':
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024.0
    
    return f"{size:.1f} PB"


def sanitize_search_query(query: str) -> str:
    """
    Sanitize a game title for use as a search query.
    
    Removes common suffixes, special characters, and normalizes spacing.
    
    Args:
        query: Raw search query
        
    Returns:
        Cleaned search query
    """
    if not query:
        return ""
    
    # Remove common release suffixes
    suffixes_to_remove = [
        r'\s*[-_]?\s*(?:repack|proper|internal|fix|update)',
        r'\s*[-_]?\s*(?:gog|steam|egs|epic)',
        r'\s*[-_]?\s*v?\d+(?:\.\d+)*$',
    ]
    
    result = query
    for pattern in suffixes_to_remove:
        result = re.sub(pattern, '', result, flags=re.IGNORECASE)
    
    # Remove special characters except spaces
    result = re.sub(r'[^\w\s]', ' ', result)
    
    # Normalize whitespace
    result = ' '.join(result.split())
    
    return result.strip()
