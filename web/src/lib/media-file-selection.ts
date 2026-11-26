// 文件过滤时保留原始 index：后面按文件顺序回填节点、命名或记录错误时，
// 不能拿过滤后的数组下标去反查原始 FileList。
export type IndexedFile<T> = { file: T; index: number };

export function filterFilesWithOriginalIndex<T>(files: readonly T[], predicate: (file: T, index: number) => boolean): IndexedFile<T>[] {
    return files.flatMap((file, index) => (predicate(file, index) ? [{ file, index }] : []));
}
