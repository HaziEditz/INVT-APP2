package com.khybertech.taxi360driver.MainActivity;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.Binder;
import android.os.IBinder;
import android.preference.PreferenceManager;
import android.support.v4.app.NotificationCompat;
import android.util.Log;
import android.widget.Toast;

import com.android.volley.RequestQueue;
import com.android.volley.toolbox.HurlStack;
import com.android.volley.toolbox.Volley;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.R;
import com.khybertech.taxi360driver.SplashSignIn;
//import com.onesignal.OneSignal;

import org.json.JSONArray;

import java.io.InputStream;
import java.security.KeyStore;
import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.Locale;
import java.util.Timer;
import java.util.TimerTask;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;

public class Taximetterservice extends Service {

    private IBinder servicebinderclass = new Servicebinderclass();

//    LocationManager locationManager;
//    LocationListener locationListener;
    int firstlocationcheck = 0;


    public Taximetterservice() {

    }

    boolean isPauseButtonPressed = false;

    Timer T, wT;
    Calendar c;
    SimpleDateFormat format;
    String currentDateTime = "";
    int countminutes = 1;
    public int countTime = 0;
    double rate = Double.parseDouble(appcontext.getInstance().fare);

    @Override
    public IBinder onBind(Intent intent) {

        return servicebinderclass;
    }

    public String gettimer() {
        Log.e("servicestartedd", "yes");
        return ("00:00:00");
    }

    int timecheck = 0;

    /*
       public void waitingstarttime(){
           if(timecheck==0) {
               timecheck=1;
               wc = Calendar.getInstance();
               wformat = new SimpleDateFormat("MM/dd/yyyy h:mm a", Locale.ENGLISH);
               wcurrentDateTime = wformat.format(wc.getTime());

    //   LocationManager lMngr = (LocationManager) getSystemService(LOCATION_SERVICE);

               Timer wT = new Timer();
               appcontext.getInstance().t = wT;

               wT.scheduleAtFixedRate(new TimerTask() {
                   @Override
                   public void run() {
                       int rate = 100;

    //                        Log.e("timer", "count="+count);
                       int hours = wcountTime / 360taxi0;
                       int minutes = (wcountTime % 360taxi0) / 60;
                       int seconds = wcountTime % 60;
                       wcountTime++;
                       if (wcountminutes == 60) {
                           rate += 20;
                           appcontext.getInstance().fare = (rate + "$");
                           wcountminutes = 1;
                       }
                       appcontext.getInstance().timeclock = String.format("%02d:%02d:%02d", hours, minutes, seconds);
                       wcountminutes++;
                       Log.e("timerserice", String.format("%02d:%02d:%02d", hours, minutes, seconds));

                   }
               }, 1000, 1000);

               Log.e("dateLol", wcurrentDateTime);
           }
        }
        */
    public class Servicebinderclass extends Binder {
        public Taximetterservice getservice() {
            return Taximetterservice.this;
        }
    }


    public void starttime() {
        try {
            wT.cancel();
            wT.purge();
            wT = null;
        } catch (Exception e) {
               e.printStackTrace();
        }

        try {
            if(!isPauseButtonPressed) {
                appcontext.getInstance().pathformetter = new ArrayList<>();
                isPauseButtonPressed = false;
            }

            countTime = (int) appcontext.getInstance().totalseconds;
            JSONArray jsonArray = new JSONArray(appcontext.getInstance().TarrifJSondata);
            if (appcontext.getInstance().isJobfixedRat) {
                appcontext.getInstance().fare = appcontext.getInstance().fixedprice;
            } else{
                appcontext.getInstance().fare = appcontext.getInstance().startingFare;
             }
//            appcontext.getInstance().DistanceRate = jsonArray.getJSONObject(0).getDouble("DistanceRate");
//            appcontext.getInstance().WaitingRate = jsonArray.getJSONObject(0).getDouble("WaitingRate");
        } catch (Exception e) {
            e.printStackTrace();
        }



        //final TextView txt_fare = (TextView) getActivity().findViewById(R.id.fare);
       //   LocationManager lMngr = (LocationManager) getSystemService(LOCATION_SERVICE);

        //appcontext.getInstance().fare = rate + "$";
        if(T==null) {
            T = new Timer();
            appcontext.getInstance().metterlastCalculatedPoint = appcontext.getInstance().realtimelocation;
            T.scheduleAtFixedRate(new TimerTask() {
                @Override
                public void run() {

//                        Log.e("timer", "count="+count);
                    int hours = countTime / 3600;
                    int minutes = (countTime % 3600) / 60;
                    int seconds = countTime % 60;
                    countTime++;
                    if (countminutes == 15) {
                        rate += appcontext.getInstance().DistanceRate;
                        //   appcontext.getInstance().fare = rate + "$";
                        countminutes = 1;
                    }
                    if(appcontext.getInstance().mIsVehicleOnWait&&!appcontext.getInstance().metterPaused){
                        appcontext.getInstance().waitingseconds ++;
                    }

                    setmettercalculation(0.0f, appcontext.getInstance().realtimelocation);

                    appcontext.getInstance().timeclock = (String.format("%02d:%02d:%02d", hours, minutes, seconds));
                    countminutes++;
                    appcontext.getInstance().totalseconds++;
                    appcontext.getInstance().lastsnap++;


                    Log.e("timer logstart", String.format("%02d:%02d:%02d", hours, minutes, seconds));

                    try {
//                        Log.e("distancefromprev", appcontext.getInstance().realtimelocation.distanceTo(appcontext.getInstance().prevRealtimeloccation) + "");
                    } catch (Exception e) {
//                        Log.e("realtimelocatioin", e.getMessage());
                    }
                }
            }, 1000, 1000);
        }

        appcontext.getInstance().backgroundstatus = "Busy";
//        Toast.makeText(this, "Metter Started", Toast.LENGTH_SHORT).show();

    }


    void setmettercalculation(Float dist,Location location){
    try {
        String uid = FirebaseAuth.getInstance().getCurrentUser().getUid();
//        final SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(getBaseContext());
        SecurePreferences pref = appcontext.getInstance().pref;
        DatabaseReference dbRef = FirebaseDatabase.getInstance().getReference().child("jobs");
        String latlngs = "";


        appcontext.getInstance().metterlastCalculatedPoint = appcontext.getInstance().realtimelocation;
            int waitingtimecal = 0;

//                try {
//                    if (location.getSpeed() < 150000.0 && location.getSpeed() > 0.0) {
//                        waitingtimecal = (int) (100.0 / location.getSpeed());
//                    }
//                } catch (Exception e) {
//                    e.printStackTrace();
//                }
                Log.e("Waitingtime", waitingtimecal + "");
//                appcontext.getInstance().waitingtime = appcontext.getInstance().distance + waitingtimecal + "";
//                double total = Float.parseFloat(appcontext.getInstance().utilmetterdistance+"");
                 DecimalFormat df = new DecimalFormat("#.##");
                 String distance2f = df.format(appcontext.getInstance().utilmetterdistance/1000);
                double  total = Double.parseDouble(distance2f);
                appcontext.getInstance().DistanceCovered = df.format(total);
                // this calculates the fare useing distance rate and wiating rate.

        if (appcontext.getInstance().isJobfixedRat) {
            appcontext.getInstance().fare = appcontext.getInstance().fixedprice;
        } else{
            appcontext.getInstance().fare = String.format("%.1f",Float.parseFloat(appcontext.getInstance()
                    .startingFare ) +   (total * appcontext.getInstance().DistanceRate)
                    + ( (appcontext.getInstance().waitingseconds)*  (appcontext.getInstance().WaitingRate/60)) )+ "";
        }

                Log.e("speed and distance", appcontext.getInstance().DistanceRate + " : " + appcontext.getInstance().WaitingRate);
                Log.e("speed utildist & wrate", total + "   " +appcontext.getInstance().waitingminutes);
                Log.e("speed utildist & second", total + "   " +appcontext.getInstance().waitingseconds);
                appcontext.getInstance().oldloc = location;
//                double hundradMetterPrice = appcontext.getInstance().DistanceRate / (1000/dist);
//                appcontext.getInstance().fare = "" + (Double.parseDouble(appcontext.getInstance().fare) + hundradMetterPrice);

        try {
            if(!appcontext.getInstance().pathformetter.isEmpty()) {
                int size = appcontext.getInstance().pathformetter.size() - 1;
                //35.27801,149.12958|-3

//                latlngs += appcontext.getInstance().pathformetter.get(size).latitude + "," + appcontext.getInstance().pathformetter.get(size).longitude + "n";

                for (int i = 0; i < appcontext.getInstance().pathformetter.size(); i++) {
                    latlngs += appcontext.getInstance().pathformetter.get(i).latitude + "," + appcontext.getInstance().pathformetter.get(i).longitude + "n";
                }
                latlngs = latlngs.substring(0, latlngs.length() - 1);
            }

            HashMap<String, Object> data = new HashMap<>();
            data.put("metterstatus",appcontext.getInstance().metterstatus + "");
            data.put("latlngpath", latlngs + "");
            data.put("time",  appcontext.getInstance().timeclock + "");
            data.put("bookingid",appcontext.getInstance().activebookingid + "");
            data.put("distance",appcontext.getInstance().DistanceCovered + "");
            data.put("totalseconds",appcontext.getInstance().totalseconds + "");
            data.put("waitingtime",appcontext.getInstance().waitingseconds + "");
            data.put("pickup",appcontext.getInstance().pickup + "");
            data.put("dropoff",appcontext.getInstance().dropoff + "");
            data.put("PassengerUid",appcontext.getInstance().JobArrivedDeviceUid + "");
            data.put("DriverId",appcontext.getInstance().DriverId + "");
            data.put("TarrifId",appcontext.getInstance().Tarrifid + "");

            dbRef.child(pref.getString("company_id"))
                    .child(pref.getString("SelectedVehicleid") + "")
                    .child(uid + "")
                    .setValue(data);

        }catch (Exception e){
            e.printStackTrace();
        }
    }catch (Exception e){
        e.printStackTrace();
    }

            }



    Calendar wc;
    SimpleDateFormat wformat;
    String wcurrentDateTime = "";
    int wcountminutes = 1;
    int wcountTime = 0;

    public void waitingstarttime() {
        wc = Calendar.getInstance();
        wformat = new SimpleDateFormat("MM/dd/yyyy h:mm a", Locale.ENGLISH);
        wcurrentDateTime = wformat.format(wc.getTime());
        //final TextView txt_estimated_time = (TextView) getActivity().findViewById(R.id.waitingtime);
        // final TextView txt_fare = (TextView) getActivity().findViewById(R.id.fare);
//   LocationManager lMngr = (LocationManager) getSystemService(LOCATION_SERVICE);

        if(wT==null) {
            wT = new Timer();
            wT.scheduleAtFixedRate(new TimerTask() {
                @Override
                public void run() {
//                        Log.e("timer", "count="+count);
                    int hours = wcountTime / 3600;
                    int minutes = (wcountTime % 3600) / 60;
                    int seconds = wcountTime % 60;
                    wcountTime++;
                    if (wcountminutes == 10) {
//                    rate += 20;
//                    appcontext.getInstance().fare = rate + "$";

                        wcountminutes = 1;
                    }
                    wcountminutes++;
                    appcontext.getInstance().waitingseconds ++;
//                    appcontext.getInstance().waitingtime =  wcountminutes+"";//(String.format("%02d:%02d:%02d", hours, minutes, seconds));

                    appcontext.getInstance().waitingminutes = minutes;
//                Log.e("timer log", String.format("%02d:%02d:%02d", hours, minutes, seconds));

                }
            }, 1000, 1000);
        }
//        Toast.makeText(this, "Waiting Started", Toast.LENGTH_SHORT).show();
        Log.e("speed waitingfunction", wcurrentDateTime);
    }


    public void stoptime() {

        //   final TextView txt_estimated_time = (TextView) getActivity().findViewById(R.id.timeclock);
        //  final TextView txt_fare = (TextView) getActivity().findViewById(R.id.fare);
        //  final TextView wtxt_estimated_time = (TextView) getActivity().findViewById(R.id.waitingtime);



        try {
            T.cancel();
            T.purge();
            T = null;
        } catch (Exception e) {
//            Toast.makeText(getApplicationContext(), "timer was not stopped", Toast.LENGTH_SHORT).show();
            e.printStackTrace();
        }
        try {
//            stopLocationupdatesprovider();
//            locationManager.removeUpdates(locationListener);
        } catch (Exception e) {

        }
        try {
            wT.cancel();
            wT.purge();
            wT = null;
        } catch (Exception e) {
//            Toast.makeText(getApplicationContext(), "waiting timer was not stopped", Toast.LENGTH_SHORT).show();
            e.printStackTrace();
        }
        currentDateTime = "";
        countminutes = 1;
        countTime = 0;
        rate = 100;

        wcurrentDateTime = "";
        wcountminutes = 1;
        wcountTime = 0;
        rate = 100;
        // txt_estimated_time.setText(String.format("%02d:%02d:%02d", 00, 00, 00));
        // wtxt_estimated_time.setText(String.format("%02d:%02d:%02d", 00, 00, 00));
        // extramoney.setText("");
        //  txt_fare.setText("00.0");
//        Toast.makeText(this, "Resetting Meter", Toast.LENGTH_SHORT).show();
    }

    public void pausetime1() {


        isPauseButtonPressed = true;

//        Toast.makeText(this, "paused", Toast.LENGTH_SHORT).show();
        try {
            T.cancel();
            T.purge();
            T = null;
        } catch (Exception e) {

        }
        try {
            appcontext.getInstance().t.cancel();
        } catch (Exception e) {

        }
        try {

            wT.cancel();
            wT.purge();
            wT = null;
        } catch (Exception e) {

        }
    }


    public void pauseWaitingtime() {
//        Toast.makeText(this, "paused", Toast.LENGTH_SHORT).show();

        try {

            wT.cancel();
            wT.purge();
            wT = null;
        } catch (Exception e) {

        }
    }

public void Locationupdatesprovider() {
        Log.e("fusedlocationcalled","yes1");
    Backgroundfusedlocationupdates backgroundfusedlocationupdates = null;

    backgroundfusedlocationupdates = new Backgroundfusedlocationupdates();
    backgroundfusedlocationupdates.mcontext = getBaseContext();
        try {

            backgroundfusedlocationupdates.startUpdatesButtonHandler();
        }catch (Exception e){
            Log.e("fusedlocationerror","yes "+e.getMessage());
            e.printStackTrace();
        }


    Log.e("fusedlocationcalled","yes2");
}
    public void stopLocationupdatesprovider() {

        Backgroundfusedlocationupdates backgroundfusedlocationupdates = new Backgroundfusedlocationupdates();
        backgroundfusedlocationupdates.stopUpdatesButtonHandler();
    }


//    public void Locationupdatesprovider() {
//
//        // Register the listener with the Location Manager to receive location updates
//        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
//            // TODO: Consider calling
//            //    ActivityCompat#requestPermissions
//            // here to request the missing permissions, and then overriding
//            //   public void onRequestPermissionsResult(int requestCode, String[] permissions,
//            //                                          int[] grantResults)
//            // to handle the case where the user grants the permission. See the documentation
//            // for ActivityCompat#requestPermissions for more details.
//            return;
//        }
//
//        // Acquire a reference to the system Location Manager
//
//        locationManager = (LocationManager) getApplicationContext().getSystemService(Context.LOCATION_SERVICE);
//        appcontext.getInstance().oldloc = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
//
//
//// Define a listener that responds to location updates
//
//        locationListener = new LocationListener() {
//            public void onLocationChanged(Location location) {
//
//                /*/ Check whether the new location fix is more or less accurate
//                int accuracyDelta = (int) (location.getAccuracy() - appcontext.getInstance().oldloc.getAccuracy());
//                boolean isLessAccurate = accuracyDelta > 0;
//                boolean isMoreAccurate = accuracyDelta < 0;
//                boolean isSignificantlyLessAccurate = accuracyDelta > 200;
//
//                if(isMoreAccurate && !isSignificantlyLessAccurate) {
//                */
//                // Called when a new location is found by the network location provider.
//                float distanceInMeters = 0.50f;
//                if(firstlocationcheck==0) {
//                    try {
//                        String picklatlng = PreferenceManager.getDefaultSharedPreferences(getApplicationContext()).getString("activejobpicklatlng", "");
//                        Location pickloc = new Location("");
//                        pickloc.setLatitude(Double.parseDouble(picklatlng.split(",")[0]));
//                        pickloc.setLongitude(Double.parseDouble(picklatlng.split(",")[1]));
//                        distanceInMeters = pickloc.distanceTo(location);
//                        Log.e("distancemm", distanceInMeters + "");
//                        firstlocationcheck = 1;
//                    }catch (Exception e){
//                        e.printStackTrace();
//                    }
//                }else {
//                    Log.e("distancemm", distanceInMeters + "");
//                    distanceInMeters  = 0.200f;
//                    firstlocationcheck =1;
//                }
//             if(distanceInMeters>=0.100f){
//                int waitingtimecal = 0;
//                try {
//                    if (location.getSpeed() < 150000.0 && location.getSpeed() > 0.0) {
//                        waitingtimecal = (int) (100.0 / location.getSpeed());
//                    }
//                } catch (Exception e) {
//                    e.printStackTrace();
//                }
//                Log.e("Waitingtime", waitingtimecal + "");
//                appcontext.getInstance().waitingtime = Integer.parseInt(appcontext.getInstance().waitingtime) + waitingtimecal + "";
//                float total = Float.parseFloat(appcontext.getInstance().DistanceCovered);
//                total += 0.100;
//                appcontext.getInstance().DistanceCovered = total + "";
//                Log.e("speed and distance", location.getSpeed() + " : " + appcontext.getInstance().DistanceCovered);
//                Log.e("accuracy", location.getAccuracy() + "");
//                appcontext.getInstance().oldloc = location;
//                double hundradMetterPrice = appcontext.getInstance().DistanceRate / 10;
//                appcontext.getInstance().fare = "" + (Double.parseDouble(appcontext.getInstance().fare) + hundradMetterPrice);
//            }
//            }
//
//            public void onStatusChanged(String provider, int status, Bundle extras) {
//            }
//
//            public void onProviderEnabled(String provider) {
//            }
//
//            public void onProviderDisabled(String provider) {
//            }
//        };
//
//        Criteria criteria = new Criteria();
//        criteria.setAccuracy(Criteria.ACCURACY_FINE);
//        criteria.setPowerRequirement(Criteria.POWER_HIGH);
//        locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0, 100, locationListener);
//
//    }

    @Override
    public void onCreate() {
        super.onCreate();

    }



    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {


        FirebaseDatabase.getInstance().getReference()
                .child("notification")
                .child(appcontext.getInstance().DriverId).setValue(null);

        Intent i = new Intent(this, SplashSignIn.class);

       PendingIntent contentIntent = PendingIntent.getActivity(this, 0, i,0);
       Notification notification = new NotificationCompat.Builder(this, "1138")
               .setVisibility(Notification.VISIBILITY_SECRET)
                .setSmallIcon(R.mipmap.app_icon)
                .setContentIntent(contentIntent)
                .setContentTitle("")
                .setContentText("")
                .build();

        startForeground(1137, notification);

        DatabaseReference connectedRef = FirebaseDatabase.getInstance().getReference(".info/connected");
        connectedRef.addValueEventListener(new ValueEventListener() {
            @Override
            public void onDataChange(DataSnapshot snapshot) {
                boolean connected = snapshot.getValue(Boolean.class);
                appcontext.getInstance().connected = connected;
                if(!appcontext.getInstance().isnotificationwindowsOpeneed){
                    FirebaseDatabase.getInstance()
                             .getReference()
                            .child("notification")
                            .child(appcontext.getInstance().DriverId)
                            .setValue(null);
                }
            }

            @Override
            public void onCancelled(DatabaseError error) {
//                System.err.println("Listener was cancelled");
            }
        });

//             startForeground(startId,new Notification());

             //initialize volley requestqueue
             getRequestQueue();
             Log.e("Metter Service","started");
             try {
                 Locationupdatesprovider();
             }catch (Exception e){
                 e.printStackTrace();
             }
//        return super.onStartCommand(intent, flags, startId);
        return START_STICKY;
    }

    public RequestQueue getRequestQueue() {
        if (appcontext.getInstance().mRequestQueue == null) {
            appcontext.getInstance().mRequestQueue = Volley.newRequestQueue(getApplicationContext(), new HurlStack(null, newSslSocketFactory()));
        }

        return appcontext.getInstance().mRequestQueue;
    }

    private SSLSocketFactory newSslSocketFactory() {
        try {
            // Get an instance of the Bouncy Castle KeyStore format
            KeyStore trusted = KeyStore.getInstance("BKS");
            // Get the raw resource, which contains the keystore with
            // your trusted certificates (root and any intermediate certs)
            InputStream in = getApplicationContext().getResources().openRawResource(R.raw.keystore);
            try {
                // Initialize the keystore with the provided trusted certificates
                // Provide the password of the keystore
                char Numb[] = {'a','n','d','r','o','i','d'};
                trusted.load(in, Numb);
            } finally {
                in.close();
            }

            String tmfAlgorithm = TrustManagerFactory.getDefaultAlgorithm();
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(tmfAlgorithm);
            tmf.init(trusted);

            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, tmf.getTrustManagers(), null);

            SSLSocketFactory sf = context.getSocketFactory();
            return sf;
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }




    @Override
    public void onDestroy() {
        Log.e("Metter service","Distroid");
        super.onDestroy();
    }
}
