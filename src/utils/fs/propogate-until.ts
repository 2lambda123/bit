import findUp from 'find-up';
import * as fs from 'fs-extra';
import * as path from 'path';

import { BIT_GIT_DIR, BIT_HIDDEN_DIR, DOT_GIT_DIR, OBJECTS_DIR } from '../../constants';

function composePath(patternPath: string, patterns: string[]): string[] {
  return patterns.map((pattern) => {
    return path.join(patternPath, pattern);
  });
}

/**
 * determine whether given path matches patterns
 */
export function pathHas(patterns: string[]): (absPath: string) => boolean {
  return (absPath: string) => {
    let state = false;
    const paths = composePath(absPath, patterns);
    for (const potentialPath of paths) {
      if (state) return state;
      state = fs.existsSync(potentialPath);
    }

    return state;
  };
}

/**
 * determine whether given path have all files/dirs
 */
export function pathHasAll(patterns: string[]): (absPath: string) => boolean {
  return (absPath: string) => {
    let state = true;
    const paths = composePath(absPath, patterns);
    for (const potentialPath of paths) {
      if (!state) return false;
      state = fs.existsSync(potentialPath);
    }

    return state;
  };
}

/**
 * search for a scope path by walking up parent directories until reaching root.
 * @param fromPath (e.g. /tmp/workspace)
 * @returns absolute scope-path if found (e.g. /tmp/workspace/.bit or /tmp/workspace/.git/bit)
 */
export function findScopePath(fromPath: string): string | undefined {
  if (!fromPath) return undefined;
  if (!fs.existsSync(fromPath)) return undefined;
  const filePath = findUp.sync(
    [
      OBJECTS_DIR, // for bare-scope
      path.join(BIT_HIDDEN_DIR, OBJECTS_DIR),
      path.join(DOT_GIT_DIR, BIT_GIT_DIR, OBJECTS_DIR),
    ],
    { cwd: fromPath, type: 'directory' }
  );
  if (!filePath) return undefined;
  if (filePath.endsWith(path.join('.git', 'objects'))) {
    return undefined; // happens when "objects" dir is deleted from the scope
  }
  return path.dirname(filePath);
}
