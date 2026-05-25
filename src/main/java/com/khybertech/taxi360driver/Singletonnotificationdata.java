package com.khybertech.taxi360driver;

import android.content.Context;

//import com.onesignal.OSNotificationReceivedResult;

/**
 * Created by Me on 5/18/2017.
 */

public class Singletonnotificationdata {
    private static final Singletonnotificationdata ourInstance = new Singletonnotificationdata();

    public static Singletonnotificationdata getInstance() {
        return ourInstance;
    }

//    public   OSNotificationReceivedResult receivedResult = null;
    public int openstatus = 0;
    public  int backpressed =0;
    public int appalive = 0;
    public Context contxt ;

    private Singletonnotificationdata() {
    }
}
