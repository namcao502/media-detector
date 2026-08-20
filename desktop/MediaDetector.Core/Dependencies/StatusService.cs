using MediaDetector.Core.Models;

namespace MediaDetector.Core.Dependencies;

// Replaces the module-level cachedStatus in app/api/status/route.ts.
public sealed class StatusService(Func<CancellationToken, Task<StatusResult>> probe)
{
    private StatusResult? _cached;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public StatusResult? Current => _cached;

    public async Task<StatusResult> GetAsync(bool refresh = false, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_cached != null && !refresh) return _cached;
            return _cached = await probe(ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Reset() => _cached = null;
}
