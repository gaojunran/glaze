/**
 * Files that can affect the generated mini-program. Styles, JSON and config
 * files are included because the build copies or reads them directly.
 */
const BUILD_SOURCE_RE = /\.(tsx?|jsx?|mjs|mts|cts|json|wxml|wxss|scss|less|css)$/

export const isBuildSourceFile = (file: string) => BUILD_SOURCE_RE.test(file)

/** Build options for a Vite hot update, or null when the file needs no rebuild. */
export const hotUpdateBuildOptions = (file: string) =>
  isBuildSourceFile(file) ? { changedFiles: [file] } : null
