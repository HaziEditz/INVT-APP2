package com.khybertech.taxi360driver.MainActivity;


import android.content.Intent;
import android.support.v4.content.LocalBroadcastManager;
import android.util.Log;

import com.khybertech.taxi360driver.Singletonnotificationdata;
//import com.onesignal.NotificationExtenderService;
//import com.onesignal.OSNotificationReceivedResult;

public class NotificationExtenderBareBonesExample  {

    String body,title;
//    @Override
//    protected boolean onNotificationProcessing(OSNotificationReceivedResult notification) {
//
//       //startActivity(new Intent(NotificationExtenderBareBonesExample.this,MainActivity.class));
//        Log.e("mynote",notification.payload.body);
//
//        body = notification.payload.body;
//
//        title = notification.payload.title;
//        Singletonnotificationdata.getInstance().receivedResult = notification;
//
//        sendBroadcast();
//        if(Singletonnotificationdata.getInstance().appalive==1) {
//            return true;
//        }else {
//            //false
//            return false;
//        }
//    }
//
//    @Override
//    public int onStartCommand(Intent intent, int flags, int startId) {
//        super.onStartCommand(intent,flags,startId);
//        return START_REDELIVER_INTENT;
//    }
    private void sendBroadcast() {
        Intent intent = new Intent("notification");
        intent.putExtra("title",title);
        intent.putExtra("body", body);
//        LocalBroadcastManager.getInstance(this).sendBroadcast(intent);
    }
}