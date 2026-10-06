"""Compare native targets only for actual syntax surviving a preserving edit."""
from libcst.metadata import MetadataWrapper, PositionProvider


def conflicts(before, after, traces):
    occurrences, declarations, files = {}, {}, {}
    for file, trace in traces.items():
        old = MetadataWrapper(trace["before"], unsafe_skip_copy=True).resolve(PositionProvider)
        new = MetadataWrapper(trace["after"], unsafe_skip_copy=True).resolve(PositionProvider)
        files[file] = trace["file"]

        def offset(module, position):
            lines = module.code.splitlines(keepends=True)
            prefix = "".join(lines[:position.line - 1]) + lines[position.line - 1][:position.column]
            return len(prefix.encode("utf-16-le")) // 2 + (module.encoding == "utf-8-sig")

        for original, updated in trace["names"].items():
            if updated not in new:
                continue  # Exactly replaced annotation/import paths and retired syntax have no surviving node.
            first, last = old[original].start, new[updated].start
            occurrences[(file, offset(trace["before"], first))] = (trace["file"], offset(trace["after"], last))
            declarations[(file, first.line, first.column)] = (trace["file"], last.line, last.column)
    uses = {(use["file"], use["start"]): use for use in after["uses"]}
    problems = []

    def identity(target):
        return target["file"], target["line"], target["column"]

    def destination(target):
        key = identity(target)
        if target["kind"] == "module":
            return files.get(target["file"], target["file"]), target["line"], target["column"]
        return declarations.get(key) if target["file"] in files else key

    for use in before["uses"]:
        position = occurrences.get((use["file"], use["start"]))
        if position is None or not use["targets"]:
            continue
        found = uses.get(position)
        mapped = [(destination(target), target["kind"]) for target in use["targets"]]
        expected = set(mapped)
        actual = {(identity(target), target["kind"]) for target in found["targets"]} if found else set()
        if any(target is None for target, _kind in mapped) or expected != actual:
            problems.append({"code": "native-binding-conflict", "file": use["file"], "start": use["start"],
                             "message": "The edit cannot preserve this native reference's declaration identity."})
    return problems
