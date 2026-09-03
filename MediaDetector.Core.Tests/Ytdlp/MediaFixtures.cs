namespace MediaDetector.Core.Tests.Ytdlp;

// Byte stubs for the tagging tests. Nothing here is played or executed, but
// TagLib# has to find a real audio frame to open a file, so an empty file with
// the right extension is not enough.
internal static class MediaFixtures
{
    // MPEG-1 Layer III, 128 kbps, 44.1 kHz stereo: 0xFF 0xFB is the sync word
    // and that header works out to a 417-byte frame.
    public static string WriteMp3(string dir, string name)
    {
        const int frameLength = 417;
        var frame = new byte[frameLength];
        frame[0] = 0xFF;
        frame[1] = 0xFB;
        frame[2] = 0x90;
        frame[3] = 0x00;

        var bytes = new List<byte>();
        for (var frameIndex = 0; frameIndex < 40; frameIndex++) bytes.AddRange(frame);

        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, name);
        File.WriteAllBytes(path, [.. bytes]);
        return path;
    }

    // A real 1x1 JPEG, so what lands in the tag is something a music app could
    // actually decode.
    public static string WriteJpeg(string dir, string name)
    {
        const string base64 =
            "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof"
            + "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB"
            + "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, name);
        File.WriteAllBytes(path, Convert.FromBase64String(base64));
        return path;
    }
}
