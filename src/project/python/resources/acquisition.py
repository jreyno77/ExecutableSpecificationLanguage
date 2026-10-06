"""Observe ordinary native configuration and distribution metadata without importing the application."""
import importlib.metadata
import json
import pathlib
import re
import sys
import sysconfig
import tomllib

root, environment = map(pathlib.Path, sys.argv[1:3])
normalize = lambda name: re.sub(r"[-_.]+", "-", name).lower()
def toml(path):
    if not path.exists():
        return {}
    with path.open("rb") as source:
        return tomllib.load(source)

project = toml(root / "pyproject.toml")
uv = project.get("tool", {}).get("uv", {})
if any(key in uv for key in ("workspace", "sources", "index", "override-dependencies", "constraint-dependencies")):
    raise ValueError("Workspace, alternate sources/indexes and dependency overrides need an explicit native profile.")
for parent in root.parents:
    if "workspace" in toml(parent / "pyproject.toml").get("tool", {}).get("uv", {}):
        raise ValueError("An ancestor uv workspace is not part of this connected project.")
requirements = []
# An empty group identifies project.dependencies; actual native group names remain distinct.
groups = [("", project.get("project", {}).get("dependencies", [])), *project.get("dependency-groups", {}).items()]
for group, values in groups:
    if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
        raise ValueError("Use explicit native dependency strings; included groups need a separate profile.")
    for value in values:
        match = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)\s*", value)
        if not match or any(token in value for token in (" @ ", "[", ";")):
            raise ValueError("Extras, conditional and non-registry requirements need an explicit native profile.")
        requirements.append({"name": normalize(match[1]), "requirement": value, "group": group})
lock = toml(root / "uv.lock")
selected = [{"name": normalize(p["name"]), "version": p["version"]} for p in lock.get("package", [])
            if p.get("source", {}).get("registry") == "https://pypi.org/simple"]
sites = [environment / ("Lib/site-packages" if sys.platform == "win32" else "lib/python3.12/site-packages")]
installed = []
for site in sites:
    if not site.exists():
        continue
    for distribution in importlib.metadata.distributions(path=[str(site)]):
        if distribution.read_text("direct_url.json"):
            raise ValueError("Direct/editable installed distributions need an explicit native profile.")
        installed.append({"name": normalize(distribution.metadata["Name"]), "version": distribution.version})
base, library = pathlib.Path(sys.base_prefix), pathlib.Path(sysconfig.get_path("stdlib"))
binaries = [str(path) for path in base.glob("python*.dll")]
if sysconfig.get_config_var("LIBDIR") and sysconfig.get_config_var("LDLIBRARY"):
    binaries.append(str((pathlib.Path(sysconfig.get_config_var("LIBDIR")) / sysconfig.get_config_var("LDLIBRARY")).resolve(strict=True)))
print(json.dumps({"requirements": requirements, "selected": selected, "installed": installed,
                  "python": {"version": sys.version.split()[0], "stdlib": [str(library)] + ([str(base / "DLLs")] if (base / "DLLs").exists() else []),
                             "binaries": binaries}, "sites": [str(site) for site in sites]}))
