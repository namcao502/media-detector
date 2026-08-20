using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace MediaDetector.Core.Processes;

// Kills a spawned download and everything it started. yt-dlp runs ffmpeg as a
// child; Process.Kill() reaps only the direct child and would leave the encoder
// running and holding the output file open. Every process assigned to this job
// dies when the job handle closes, so an orphan is impossible by construction.
//
// This replaces the `taskkill /pid N /T /F` shell-out at lib/ytdlp.ts:501.
[SupportedOSPlatform("windows")]
public sealed partial class JobObject : IDisposable
{
    // Name differs from the struct below on purpose: sharing the identifier
    // between a const and a nested type is CS0102.
    private const int JobObjectInfoClassExtendedLimit = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x2000;

    private nint _handle;
    private bool _disposed;

    // Set when AssignProcessToJobObject failed, so Terminate knows the tree is
    // NOT inside the job and must be killed the old way.
    private int _unassignedPid;

    public JobObject()
    {
        _handle = CreateJobObjectW(0, null);
        if (_handle == 0)
            throw new InvalidOperationException(
                $"CreateJobObject failed: {Marshal.GetLastPInvokeError()}");

        var info = new JobObjectExtendedLimitInformation
        {
            BasicLimitInformation = new JobObjectBasicLimitInformation
            {
                LimitFlags = JobObjectLimitKillOnJobClose,
            },
        };

        var size = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
        var ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, ptr, false);
            if (!SetInformationJobObject(_handle, JobObjectInfoClassExtendedLimit, ptr, (uint)size))
                throw new InvalidOperationException(
                    $"SetInformationJobObject failed: {Marshal.GetLastPInvokeError()}");
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    // Assign immediately after Process.Start, before the child has time to spawn
    // its own children -- anything it starts afterwards inherits the job.
    //
    // Process.Start -> Assign is NOT atomic: a grandchild spawned inside that
    // window escapes the job. The window is microseconds and yt-dlp does not
    // spawn ffmpeg until well into the run, so this is accepted rather than
    // solved (solving it needs CreateProcess with CREATE_SUSPENDED, which
    // System.Diagnostics.Process does not expose).
    //
    // Returns false when the process could not be assigned. Callers must not
    // ignore this: an unassigned process survives Dispose, which is exactly the
    // orphaned-ffmpeg failure this type exists to prevent.
    public bool Assign(Process process)
    {
        if (_disposed || _handle == 0) return false;
        try
        {
            if (process.HasExited) return true;
            if (AssignProcessToJobObject(_handle, process.Handle)) return true;
            _unassignedPid = process.Id;
            return false;
        }
        catch (InvalidOperationException)
        {
            // Process exited between the check and the call; nothing to assign.
            return true;
        }
    }

    // Kills every process in the job without waiting for the handle to close.
    public void Terminate()
    {
        if (_disposed || _handle == 0) return;
        TerminateJobObject(_handle, 1);

        // Fallback for a process the job never accepted: taskkill /T walks the
        // tree by parent pid, which is the mechanism lib/ytdlp.ts:505 uses today.
        if (_unassignedPid != 0)
        {
            try
            {
                using var killer = Process.Start(new ProcessStartInfo("taskkill")
                {
                    ArgumentList = { "/pid", _unassignedPid.ToString(), "/T", "/F" },
                    UseShellExecute = false,
                    CreateNoWindow = true,
                });
                killer?.WaitForExit(3000);
            }
            catch
            {
                // Nothing further we can do; the process may already be gone.
            }
            _unassignedPid = 0;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        // Anything the job never accepted would survive CloseHandle, so kill it
        // explicitly first.
        if (_unassignedPid != 0) Terminate();
        _disposed = true;
        if (_handle != 0)
        {
            // KILL_ON_JOB_CLOSE means closing the last handle kills the tree.
            CloseHandle(_handle);
            _handle = 0;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public nuint MinimumWorkingSetSize;
        public nuint MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public nuint Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public nuint ProcessMemoryLimit;
        public nuint JobMemoryLimit;
        public nuint PeakProcessMemoryUsed;
        public nuint PeakJobMemoryUsed;
    }

    [LibraryImport("kernel32.dll", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    private static partial nint CreateJobObjectW(nint securityAttributes, string? name);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetInformationJobObject(
        nint job, int infoClass, nint info, uint infoLength);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool AssignProcessToJobObject(nint job, nint process);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool TerminateJobObject(nint job, uint exitCode);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CloseHandle(nint handle);
}
