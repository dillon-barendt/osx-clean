// JXA helper: moves files to the macOS Trash via NSFileManager with Finder fallback.
// Reads a JSON array of paths from the file given as argv[0],
// prints a JSON array of { path, ok, error? } to stdout.
ObjC.import("Foundation");

function readJSON(path) {
  const contents = $.NSString.stringWithContentsOfFileEncodingError(
    path,
    $.NSUTF8StringEncoding,
    null,
  );
  return JSON.parse(ObjC.unwrap(contents));
}

function unlockAndPrepare(fm, p) {
    try {
        const err = $();
        const currentAttrs = fm.attributesOfItemAtPathError(p, err);
        const isDir =
            currentAttrs &&
            ObjC.unwrap(currentAttrs.objectForKey($.NSFileType)) === "NSFileTypeDirectory";
        const newAttrs = $.NSMutableDictionary.alloc.init;
        newAttrs.setObjectForKey($(false), $.NSFileImmutable);
        if (currentAttrs) {
            const perms = ObjC.unwrap(currentAttrs.objectForKey($.NSFilePosixPermissions)) || 0;
            newAttrs.setObjectForKey($(perms | 0o200), $.NSFilePosixPermissions);
        } else {
            newAttrs.setObjectForKey($(isDir ? 0o755 : 0o666), $.NSFilePosixPermissions);
        }
        const setErr = $();
        fm.setAttributesOfItemAtPathError(newAttrs, p, setErr);
    } catch (e) {
    }
}

function run(argv) {
  const paths = readJSON(argv[0]);
  const fm = $.NSFileManager.defaultManager;
    let finderApp = null;

    function getFinder() {
        if (!finderApp) {
            finderApp = Application("Finder");
        }
        return finderApp;
    }

  const results = paths.map(function (p) {
    try {
        unlockAndPrepare(fm, p);
      const url = $.NSURL.fileURLWithPath(p);
      const error = $();
      const ok = fm.trashItemAtURLResultingItemURLError(url, null, error);
      if (ok === true) return { path: p, ok: true };

        // Fallback to Finder for CloudStorage / FileProvider domains and volumes
        try {
            const finder = getFinder();
            finder.delete(Path(p));
            return {path: p, ok: true};
        } catch (finderErr) {
            let message = "Could not move to Trash.";
            try {
                message = ObjC.unwrap(error.localizedDescription) || message;
            } catch (e) {
                /* keep generic message */
            }
            if (finderErr && finderErr.message) {
                message = finderErr.message;
            }
            return {path: p, ok: false, error: message};
        }
    } catch (e) {
      return { path: p, ok: false, error: String(e) };
    }
  });

  return JSON.stringify(results);
}
