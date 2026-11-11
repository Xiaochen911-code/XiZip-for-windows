using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;

namespace XiZip.Services;

public sealed class ArchiveSession
{
    public string Id { get; init; } = "";
    public string FilePath { get; init; } = "";
    public string Name { get; init; } = "";
    public string Dir { get; init; } = "";
}

public sealed class Job
{
    public string Id { get; init; } = "";
    public string Kind { get; init; } = "extract";
    public string State { get; set; } = "running";
    public int Percent { get; set; }
    public string Current { get; set; } = "";
    public int Files { get; set; }
    public int Total { get; set; }
    public long Bytes { get; set; }
    public string Target { get; set; } = "";
    public string Name { get; set; } = "";
    public string Sid { get; set; } = "";
    public string Error { get; set; } = "";
    public double Started { get; init; } = Now();
    public double Finished { get; set; }

    public static double Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
}

/// <summary>会话、任务与临时目录管理。</summary>
public static class Store
{
    public static readonly string TempRoot = Path.Combine(
        Path.GetTempPath(), "xizip-dotnet", Guid.NewGuid().ToString("N")[..10]);

    public static readonly ConcurrentDictionary<string, ArchiveSession> Sessions = new();
    public static readonly ConcurrentDictionary<string, Job> Jobs = new();
    public static readonly ConcurrentDictionary<string, Process> Processes = new();
    public static readonly HashSet<string> Cancelled = new(StringComparer.Ordinal);
    public static readonly object Sync = new();

    public static string NewId() => Guid.NewGuid().ToString("N")[..12];

    public static ArchiveSession NewSession(string filePath, string displayName)
    {
        var id = NewId();
        var dir = Path.Combine(TempRoot, id);
        Directory.CreateDirectory(dir);
        var session = new ArchiveSession
        {
            Id = id,
            FilePath = filePath,
            Name = displayName,
            Dir = dir,
        };
        Sessions[id] = session;
        return session;
    }

    public static Dictionary<string, object?> BuildPayload(ArchiveSession session)
    {
        var entries = SevenZip.List(session.FilePath);
        var files = entries.Where(entry => !entry.IsDir).ToList();
        var dirs = entries.Where(entry => entry.IsDir).ToList();
        var totalSize = files.Sum(entry => entry.Size);
        var packedSize = files.Sum(entry => entry.Packed);
        return new Dictionary<string, object?>
        {
            ["id"] = session.Id,
            ["name"] = session.Name,
            ["size"] = new FileInfo(session.FilePath).Length,
            ["entryCount"] = entries.Count,
            ["fileCount"] = files.Count,
            ["dirCount"] = dirs.Count,
            ["totalSize"] = totalSize,
            ["packedSize"] = packedSize,
            ["ratio"] = totalSize > 0 ? Math.Round((double)packedSize / totalSize, 3) : 0,
            ["entries"] = entries,
        };
    }

    public static Dictionary<string, object?> Snapshot(Job job)
    {
        lock (Sync)
        {
            return new Dictionary<string, object?>
            {
                ["id"] = job.Id,
                ["kind"] = job.Kind,
                ["state"] = job.State,
                ["percent"] = job.Percent,
                ["current"] = job.Current,
                ["files"] = job.Files,
                ["total"] = job.Total,
                ["bytes"] = job.Bytes,
                ["target"] = job.Target,
                ["name"] = job.Name,
                ["sid"] = job.Sid,
                ["error"] = job.Error,
                ["started"] = job.Started,
                ["finished"] = job.Finished,
            };
        }
    }

    public static void PruneJobs()
    {
        var now = Job.Now();
        foreach (var pair in Jobs)
        {
            if (pair.Value.State != "running" && now - pair.Value.Finished > 300)
            {
                Jobs.TryRemove(pair.Key, out _);
            }
        }
    }

    /// <summary>递归统计目录当前字节数；项目过多时返回 -1。</summary>
    public static long FolderBytes(string root, int limit = 20000)
    {
        if (!Directory.Exists(root))
        {
            return 0;
        }
        long total = 0;
        var seen = 0;
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            IEnumerable<string> children;
            try
            {
                children = Directory.EnumerateFileSystemEntries(current);
            }
            catch
            {
                continue;
            }
            foreach (var child in children)
            {
                try
                {
                    if (Directory.Exists(child))
                    {
                        stack.Push(child);
                    }
                    else
                    {
                        total += new FileInfo(child).Length;
                    }
                }
                catch
                {
                    continue;
                }
                if (++seen > limit)
                {
                    return -1;
                }
            }
        }
        return total;
    }

    public static void Cleanup()
    {
        foreach (var pair in Processes)
        {
            try
            {
                if (!pair.Value.HasExited)
                {
                    pair.Value.Kill(true);
                }
            }
            catch { /* ignore */ }
        }
        Processes.Clear();
        try
        {
            Directory.Delete(TempRoot, true);
        }
        catch { /* ignore */ }
    }
}
