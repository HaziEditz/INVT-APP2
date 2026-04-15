package com.khybertech.taxi360driver;

import android.app.Application;
import android.util.Log;

//import com.onesignal.OSNotification;
//import com.onesignal.OneSignal;

/**
 * Created by AK on 25/12/2016.
 */

public class MyApp extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
//        OneSignal.startInit(this).inFocusDisplaying(OneSignal.OSInFocusDisplayOption.Notification).setNotificationReceivedHandler(this).init();
    }

//    @Override
//    public void notificationReceived(OSNotification notification) {
//        Log.e("OneSignal","Rcv");
//    }
}
