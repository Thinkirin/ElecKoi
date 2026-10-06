package com.eleckoi.unified.android;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Concatenates matching PCM WAV segments produced by the platform TTS engine. */
final class WaveAudio {
    private static long little(RandomAccessFile input) throws IOException { return Integer.toUnsignedLong(Integer.reverseBytes(input.readInt())); }
    private static void little(DataOutputStream output, long value) throws IOException { output.writeInt(Integer.reverseBytes((int)value)); }
    static void merge(List<File> parts, File output) throws IOException {
        byte[] format = null;
        ArrayList<long[]> ranges = new ArrayList<>(); long total = 0;
        for (File part : parts) {
            try (RandomAccessFile input = new RandomAccessFile(part,"r")) {
                if (input.readInt() != 0x52494646) throw new IOException("System TTS audio is not RIFF WAV"); little(input);
                if (input.readInt() != 0x57415645) throw new IOException("System TTS audio is not WAV");
                byte[] current = null; long dataOffset = -1, dataLength = 0;
                while (input.getFilePointer()+8 <= input.length()) {
                    int kind = input.readInt(); long length = little(input), offset = input.getFilePointer();
                    if (length > input.length()-offset) throw new IOException("Truncated system TTS WAV");
                    if (kind == 0x666d7420) { current = new byte[(int)length]; input.readFully(current); }
                    if (kind == 0x64617461) { dataOffset = offset; dataLength = length; }
                    input.seek(offset+length+(length&1));
                }
                if (current == null || dataOffset < 0) throw new IOException("System TTS WAV format/data is missing");
                if (format == null) format = current; else if (!Arrays.equals(format,current)) throw new IOException("System TTS segments use different audio formats");
                ranges.add(new long[]{dataOffset,dataLength}); total += dataLength;
            }
        }
        if (format == null || total > 0xffffffffL-64) throw new IOException("System TTS WAV is empty or exceeds RIFF size");
        try (DataOutputStream target = new DataOutputStream(new FileOutputStream(output))) {
            target.writeBytes("RIFF"); little(target,4+8+format.length+(format.length&1)+8+total+(total&1)); target.writeBytes("WAVEfmt ");
            little(target,format.length); target.write(format); if ((format.length&1)!=0) target.write(0);
            target.writeBytes("data"); little(target,total); byte[] bytes = new byte[65536];
            for (int index=0; index<parts.size(); index++) try (RandomAccessFile input = new RandomAccessFile(parts.get(index),"r")) {
                long[] range=ranges.get(index); input.seek(range[0]); long remaining=range[1];
                while (remaining>0) { int count=input.read(bytes,0,(int)Math.min(bytes.length,remaining)); if(count<0)throw new EOFException(); target.write(bytes,0,count); remaining-=count; }
            }
            if ((total&1)!=0) target.write(0);
        }
    }
}
