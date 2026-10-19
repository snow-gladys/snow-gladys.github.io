package com.snowgladys.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;

/** 网页仍负责音频；原生媒体会话提供通知栏、耳机控制和播放期间的前台服务。 */
public final class PlaybackService extends Service {
    public static final String STATE = "com.snowgladys.player.STATE";
    private static final String CHANNEL = "music_playback";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable expirePaused = this::stopSelf;
    private MediaSession session;
    private boolean playing;
    private String title = "思诺 · Gladys", artist = "思诺";

    @Override public void onCreate() {
        super.onCreate();
        NotificationChannel channel = new NotificationChannel(CHANNEL, "音乐播放", NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
        session = new MediaSession(this, "GladysPlayer");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { control("play", 0); }
            @Override public void onPause() { control("pause", 0); }
            @Override public void onSkipToNext() { control("next", 0); }
            @Override public void onSkipToPrevious() { control("previous", 0); }
            @Override public void onSeekTo(long position) { control("seek", position); }
            @Override public void onStop() { control("pause", 0); stopSelf(); }
        });
        session.setActive(true);
    }

    private void control(String action, long position) {
        if (!MainActivity.dispatchPlayback(action, position)) stopSelf();
    }
    private PendingIntent action(String action, int code) {
        return PendingIntent.getService(this, code, new Intent(this, PlaybackService.class).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private String label(String text) { return text.length() > 200 ? text.substring(0, 200) : text; }

    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if (!STATE.equals(intent.getAction())) { control(intent.getAction() == null ? "" : intent.getAction(), 0); return START_NOT_STICKY; }
        playing = intent.getBooleanExtra("playing", false);
        title = label(intent.getStringExtra("title") == null ? title : intent.getStringExtra("title"));
        artist = label(intent.getStringExtra("artist") == null ? artist : intent.getStringExtra("artist"));
        long position = Math.max(0, intent.getLongExtra("position", 0)), duration = Math.max(0, intent.getLongExtra("duration", 0));
        session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist).putLong(MediaMetadata.METADATA_KEY_DURATION, duration).build());
        session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
            PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, playing ? 1f : 0f, SystemClock.elapsedRealtime()).build());
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, CHANNEL).setContentTitle(title).setContentText(artist)
            .setSmallIcon(android.R.drawable.ic_media_play).setContentIntent(open).setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true).setOngoing(playing).setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "上一首", action("previous", 1)).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "暂停" : "播放", action(playing ? "pause" : "play", 2)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "下一首", action("next", 3)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(1, notification);
        handler.removeCallbacks(expirePaused);
        if (!playing) handler.postDelayed(expirePaused, 5 * 60 * 1000L);
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (session != null) { session.setActive(false); session.release(); }
        stopForeground(STOP_FOREGROUND_REMOVE); MainActivity.playbackServiceStopped(); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
