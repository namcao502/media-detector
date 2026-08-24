using MediaDetector.Core.Models;

namespace MediaDetector.Core.Formats;

// Picks the format most people want, so one row in a long list can be badged
// "Best" instead of leaving the user to compare codecs. Pure -- no mutation,
// returns the chosen formatId or null when there is nothing to choose from.
public static class Recommend
{
    // Highest resolution, breaking ties toward mp4 (plays everywhere) then fps.
    public static string? VideoId(IReadOnlyList<VideoFormat> formats)
    {
        if (formats.Count == 0) return null;

        var best = formats.Aggregate((winner, candidate) =>
        {
            if (candidate.Height != winner.Height)
                return candidate.Height > winner.Height ? candidate : winner;

            var candidateIsMp4 = candidate.Ext.Equals("mp4", StringComparison.OrdinalIgnoreCase);
            var winnerIsMp4 = winner.Ext.Equals("mp4", StringComparison.OrdinalIgnoreCase);
            if (candidateIsMp4 != winnerIsMp4) return candidateIsMp4 ? candidate : winner;

            return (candidate.Fps ?? 0) > (winner.Fps ?? 0) ? candidate : winner;
        });

        return best.FormatId;
    }

    // Highest bitrate among the containers an iPhone plays natively; only falls
    // back to the overall highest bitrate when nothing Apple-playable is on offer.
    public static string? AudioId(IReadOnlyList<AudioFormat> formats)
    {
        if (formats.Count == 0) return null;

        var playable = formats.Where(f => AudioCompat.IsApplePlayable(f.Ext)).ToArray();
        IReadOnlyList<AudioFormat> pool = playable.Length != 0 ? playable : formats;
        var best = pool.Aggregate((winner, candidate) =>
            (candidate.Abr ?? 0) > (winner.Abr ?? 0) ? candidate : winner);

        return best.FormatId;
    }
}
