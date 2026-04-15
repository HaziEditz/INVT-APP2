package com.khybertech.taxi360driver.MainActivity;

import android.Manifest;
import android.app.ActivityManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.AsyncTask;
import android.os.Handler;
import android.os.IBinder;
import android.preference.PreferenceManager;
import android.support.v4.app.ActivityCompat;
import android.support.v4.content.ContextCompat;
import android.support.v4.content.LocalBroadcastManager;
import android.support.v4.widget.DrawerLayout;
import android.support.v7.app.AlertDialog;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.Animation;
import android.view.animation.AnimationUtils;
import android.widget.AdapterView;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SimpleAdapter;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.RequestQueue;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.HurlStack;
import com.android.volley.toolbox.StringRequest;
import com.android.volley.toolbox.Volley;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.firebase.auth.GetTokenResult;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.ValueEventListener;
import com.khybertech.taxi360driver.Chat.ChatActivity;
import com.khybertech.taxi360driver.JobView.CurrentJobDetail;
import com.khybertech.taxi360driver.JobView.Fragments.Taximetter;
import com.khybertech.taxi360driver.JobView.JobView;
import com.khybertech.taxi360driver.JobView.OfferedJobDetail;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.Maps.MapsActivityJobLocation;
import com.khybertech.taxi360driver.MyAccountActivity;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.ShiftHistory.ShiftsHistory;
import com.khybertech.taxi360driver.SignIn.EmailPasswordActivity;
import com.khybertech.taxi360driver.Singletonnotificationdata;
import com.khybertech.taxi360driver.SplashSignIn;
import com.khybertech.taxi360driver.StartShift.StartShift;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.maps.android.SphericalUtil;
//import com.onesignal.OSNotification;
//import com.onesignal.OSNotificationOpenResult;
//import com.onesignal.OSNotificationPayload;
//import com.onesignal.OSNotificationReceivedResult;
//import com.onesignal.OneSignal;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.URL;
import java.security.KeyManagementException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.cert.CertificateException;
import java.text.DecimalFormat;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;


import com.khybertech.taxi360driver.R;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;

import de.hdodenhof.circleimageview.CircleImageView;

public class MainActivity extends AppCompatActivity  {

    int permissionCheckCoarseLoc = 0;
    LocationManager locationManager;
    LocationListener locationListener;
    Taximetter Taximtterobj;
    GridView lv_mainactivity_navdrawer;
    SimpleAdapter adapter;
    TextView tv;
    String player_id="";
    String NotificationJobArrivedBooking_id = "0";

    int clicked = 10;
    String shiftname = "Offline";
    String[] titles_navdrawer = {shiftname,"Job View","Metter","Settings","History","Sign Out"};
    int[] images_navdrawer = {R.drawable.startshift,R.drawable.jobview,R.drawable.history,R.drawable.settings,R.drawable.whatsnew,R.drawable.signout}; List<HashMap<String, Object>> ls_data_navdrawer;
//    SharedPreferences pref;
//    SharedPreferences.Editor edit;
    SecurePreferences pref,edit;

    TextView txt_name, txt_name_navdrawer;
    String logoutTime, logoutDate, currentDateTime;
    int driverId;
    TextView txt_driverStatus;
    ImageView iv_openDrawer_main;
    DrawerLayout dLayout;


    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState); /* This code together with the one in onDestroy()
         * will make the screen be always on until this Activity gets destroyed. */
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_main);

        appcontext.getInstance().con = getApplicationContext();

        getRequestQueue();

        try {
             if (isDeviceRooted()==true){
                 Log.e("rooted","yes it is");
             }else {
                 Log.e("rooted","no it is not");
             }

        } catch (Exception e) {
            e.printStackTrace();
        }
        Singletonnotificationdata.getInstance().openstatus = 1;
        widgets();

        txt_driverStatus.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                startActivity(new Intent(MainActivity.this,ZonesDetails.class));
            }
        });

        //ser
        if(isMyServiceRunning(Taximetterservice.class)) {
            Log.e("Servie","already running");
        }else {
            Intent taximetterserviceintentalways = new Intent(getApplicationContext(), Taximetterservice.class);
            getApplicationContext().startService(taximetterserviceintentalways);
            appcontext.getInstance().taximetterserviceintentalways = taximetterserviceintentalways;
        }



//        ((LinearLayout)findViewById(R.id.emergency)).setOnLongClickListener(new View.OnLongClickListener() {
//            @Override
//            public boolean onLongClick(View view) {
//                android.app.AlertDialog alertDialog = new android.app.AlertDialog.Builder (MainActivity.this).create();
//                alertDialog.setTitle("Emergency Message");
//                alertDialog.setMessage("An Emergancy message has been sent to the dispatcher");
//                alertDialog.setButton(android.app.AlertDialog.BUTTON_NEUTRAL, "OK",
//                        new DialogInterface.OnClickListener() {
//                            public void onClick(DialogInterface dialog, int which) {
//                                dialog.dismiss();
//                            }
//                        });
//                alertDialog.show();
//
//                return true;
//            }
//        });

        LocationManager locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);

        if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)){
            Toast.makeText(this, "GPS is Enabled in your devide", Toast.LENGTH_SHORT).show();
        }else{
            showGPSDisabledAlertToUser();
        }


// was created to change the home screen look and feel


//        LinearLayout shiftstartlinear = (LinearLayout)findViewById(R.id.shift);
//
//        shiftstartlinear.setOnClickListener(new View.OnClickListener() {
//            @Override
//            public void onClick(View v) {
//                //startActivity(new Intent(MainActivity.this, StartShift.class));
//
//            }
//        });
//
//
//        ((LinearLayout)findViewById(R.id.myrides)).setOnClickListener(new View.OnClickListener() {
//            @Override
//            public void onClick(View v) {
//
//            }
//        });
//
//        ((LinearLayout)findViewById(R.id.metter)).setOnClickListener(new View.OnClickListener() {
//            @Override
//            public void onClick(View v) {
//
//
//            }
//        });
//        ((LinearLayout)findViewById(R.id.settings)).setOnClickListener(new View.OnClickListener() {
//            @Override
//            public void onClick(View v) {
//
//            }
//        });
//
//        ((LinearLayout)findViewById(R.id.history)).setOnClickListener(new View.OnClickListener() {
//            @Override
//            public void onClick(View v) {
//
//            }
//        });
//
//        ((LinearLayout)findViewById(R.id.logout)).setOnClickListener(new View.OnClickListener() {
//            @Override
//            public void onClick(View v) {
//
//            }
//        });


       // appcontext.getInstance().con = getApplicationContext();
       Singletonnotificationdata.getInstance().appalive = 1;
        Taximtterobj = new Taximetter();
        appcontext.getInstance().taximetterfragment = Taximtterobj;
       // populateListView();
//        OneSignal.startInit(this).inFocusDisplaying(OneSignal.OSInFocusDisplayOption.InAppAlert).setNotificationOpenedHandler(this).init();

//                pref = PreferenceManager.getDefaultSharedPreferences(MainActivity.this);
//        appcontext.getInstance().pref = new SecurePreferences(this, "Google_Analytics_Com", appcontext.getInstance().collectedsensordata, true);
        pref = appcontext.getInstance().pref;
        try {
            appcontext.getInstance().CompanyID = pref.getString("companyIdForAutoLogin");
        }catch (Exception e){
            e.printStackTrace();
        }


             BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String someValue = intent.getStringExtra("body");

//                    notificationrecieved();

            }
        };
        LocalBroadcastManager.getInstance(this).registerReceiver(receiver, new IntentFilter("notification"));


        try {
            shiftss = "logoff";
            try {
                shiftss = (pref.getString("Shiftstatus")==null)? "":pref.getString("Shiftstatus");
            }catch (Exception e){
                shiftss = "logoff";

                e.printStackTrace();
            }
            if (shiftss.equalsIgnoreCase("started")) {
                Log.e("shiftstarted","yes");
                shiftname = "Online";
                titles_navdrawer[0]=shiftname;
                txt_name_navdrawer.setText(pref.getString("name")+"\nVehicle: "
                                          +pref.getString("SelectedVehicleName"));
//                ((LinearLayout)findViewById(R.id.shift))
//                        .setBackgroundColor(Color.GREEN);
                //Toast.makeText(taximetterservice, "Shift started", Toast.LENGTH_SHORT).show();
            }else {

                Log.e("shiftstarted","NO");
            }
        }catch (Exception e){
            e.printStackTrace();
        }
        edit = appcontext.getInstance().pref;
        pref = appcontext.getInstance().pref;
        // below is the gridview method
        populateListView();
        Singletonnotificationdata.getInstance().contxt = this;
        Calendar c = Calendar.getInstance();
        SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
        currentDateTime = format.format(c.getTime());
        try {
            String did = pref.getString("driverid");
            driverId = Integer.parseInt(did);
             }catch (Exception e){
            e.printStackTrace();
        }
        Log.e("driverid",pref.getString("driverid")+"");
        if(appcontext.getInstance().DriverId.equalsIgnoreCase("")) {
            appcontext.getInstance().DriverId = driverId + "";
        }

        try {
              txt_name.setText(pref.getString("name"));
            txt_name_navdrawer.setText(pref.getString("name") + "\nVehicle: "
                    + pref.getString("SelectedVehicleName"));
        }catch (Exception e){
            e.printStackTrace();
        }
        ((LinearLayout)findViewById(R.id.driver_name)).setOnLongClickListener(new View.OnLongClickListener() {

            @Override
            public boolean onLongClick(View v) {

                Calendar c = Calendar.getInstance();
                SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
                currentDateTime = format.format(c.getTime());

                HashMap<String, Object> data = new HashMap<>();
                data.put("lat", appcontext.getInstance().realtimelocation.getLatitude() + "");
                data.put("lng", appcontext.getInstance().realtimelocation.getLatitude() + "");
                data.put("driverName", pref.getString("name"));
                data.put("vehiclenumber", pref.getString("SelectedVehicleName"));
                data.put("time", currentDateTime);

                FirebaseDatabase.getInstance()
                        .getReference()
                        .child("Emergency")
                        .child(pref.getString("company_id"))
                        .child(pref.getString("SelectedVehicleid") + "")
                        .child(FirebaseAuth.getInstance().getCurrentUser().getUid() + "")
                        .setValue(data);


                return false;
            }
        });
    }

    private boolean isMyServiceRunning(Class<?> serviceClass) {
        ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        for (ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
            if (serviceClass.getName().equals(service.service.getClassName())) {
                return true;
            }
        }
        return false;
    }

    private void showGPSDisabledAlertToUser(){
        AlertDialog.Builder alertDialogBuilder = new AlertDialog.Builder(this);
        alertDialogBuilder.setMessage("GPS is disabled in your device. Would you like to enable it?")
                .setCancelable(false)
                .setPositiveButton("Goto Settings Page To Enable GPS",
                        new DialogInterface.OnClickListener(){
                            public void onClick(DialogInterface dialog, int id){
                                Intent callGPSSettingIntent = new Intent(
                                        android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                                startActivity(callGPSSettingIntent);
                            }
                        });
        alertDialogBuilder.setNegativeButton("Cancel",
                new DialogInterface.OnClickListener(){
                    public void onClick(DialogInterface dialog, int id){
                        dialog.cancel();
                    }
                });
        AlertDialog alert = alertDialogBuilder.create();
        alert.show();
    }



//    void notificationrecieved() {
//        OSNotificationReceivedResult result =  Singletonnotificationdata.getInstance().receivedResult;
//        final String id_sender,username,id_job = null;
//        String ifMessage = "You have New Message";
//        String ifJob = "You have offered new Job please view details";
//        String ifkicked = "You have been Kicked";
//        String ifsuspend = "You have been Suspended";
//        try {
//            OSNotificationPayload payload = result.payload;
//            String body = payload.body;
//            if (body.equalsIgnoreCase(ifMessage)){
//                JSONObject additionalData = payload.additionalData;
//                id_sender = additionalData.getString("SenderId");
//                username = additionalData.getString("username");
//                player_id = additionalData.getString("DeviceId");
//                Log.e("playeridrecieved",player_id);
//                Log.e("chatmsgrecieved",payload.additionalData.toString());
//                Toast.makeText(this, "message", Toast.LENGTH_SHORT).show();
//                pref.put("chatdataid"+id_sender,0+"");
//                new Handler().postDelayed(new Runnable() {
//                    @Override
//                    public void run() {
//                        startActivity(new Intent(MainActivity.this,ChatActivity.class).putExtra("id", id_sender).putExtra("name", username).putExtra("player_id",player_id));
//                    }
//                },500);
//            }else if(body.equalsIgnoreCase(ifkicked) || body.equalsIgnoreCase(ifsuspend)){
//                SimpleDateFormat toFullDate = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
//                try {
//                    Date fullDate = toFullDate.parse(currentDateTime.replace("p.m.","PM").replace("a.m.","AM"));
//                    SimpleDateFormat dateOnlyDate = new SimpleDateFormat("MM-dd-yyyy");
//                    SimpleDateFormat timeOnlyTime = new SimpleDateFormat("h:mm:ss a");
//                    logoutDate = dateOnlyDate.format(fullDate);
//                    logoutTime = timeOnlyTime.format(fullDate).replace(".","");
//                    clicked = 3;
//                    Makelogoutrequest();
//
////                                new logout().execute();
//                } catch (ParseException e) {
//                    Log.e("error",e.getMessage());
//                }
//            }
//            else if (body.equalsIgnoreCase(ifJob)){
//               // Toast.makeText(this, "job", Toast.LENGTH_SHORT).show();
//                new Handler().postDelayed(new Runnable() {
//                    @Override
//                    public void run() {
//                        jobarived();
//                    //    startActivity(new Intent(MainActivity.this,JobView.class).putExtra("fromNotification",1));
//                    }
//                },100);
//            }
//            Log.e("hey",body);
//        }
//        catch (Exception ex){
//
//        }
//    }

    void jobarived(){
        pref.put("offersstatus",0+"");

        // viewpager_jobview.setCurrentItem(2);
        JSONArray arr = null;
        String booking_id="0";
        String Status="";
        try {

//               Log.e("datarec",Singletonnotificationdata.getInstance().receivedResult.payload.additionalData.toString());
            JSONObject obj = null; //Singletonnotificationdata.getInstance().receivedResult.payload.additionalData;
            booking_id = obj.getString("BookingId").split(",")[0];
            Status = obj.getString("BookingId").split(",")[1];
            try {
                appcontext.getInstance().playerID = obj.getString("BookingId").split(",")[2];
                appcontext.getInstance().JobArrivedDeviceUid =  obj.getString("BookingId").split(",")[3];
                appcontext.getInstance().JobArrivedDeviceType =  obj.getString("BookingId").split(",")[4];

            }catch (Exception e){
                e.printStackTrace();
            }
           // Toast.makeText(MainActivity.this, "lol"+booking_id, Toast.LENGTH_LONG).show();
            String dat = "";
            if(pref.getString("prevjobid")==null){
                dat = "";
            }else {
                dat =pref.getString("prevjobid");
            }
            if(dat.equalsIgnoreCase(booking_id)){
                Log.e("prevjobid",booking_id+"");
//                Toast.makeText(this, "Job offered please goto offers for details", Toast.LENGTH_SHORT).show();
                return;
            }else {
                Log.e("prevjobidcreate",booking_id+"");
                pref.put("prevjobid",booking_id);
            }

            Log.e("",booking_id+"1");
        } catch (JSONException e) {
            Toast.makeText(MainActivity.this, "lol"+e.getMessage(), Toast.LENGTH_LONG).show();
            Log.e("bookingidnotfound",e.getMessage());
            e.printStackTrace();
        }

        if(Status.equalsIgnoreCase("pending")) {
            //enable this to actualy open offeredjobdetailview
            startActivity(new Intent(MainActivity.this, OfferedJobDetail.class).putExtra("booking_id", booking_id));
        }else if (Status.equalsIgnoreCase("Offered")){
            //enable this to actualy open offeredjobdetailview
            startActivity(new Intent(MainActivity.this, OfferedJobDetail.class).putExtra("booking_id", booking_id).putExtra("statuschanged","offered"));

        }
    }

    void jobarivedfromfirebase(String data){

        String booking_id="0";
        String Status="";
        try {

//               Log.e("datarec",Singletonnotificationdata.getInstance().receivedResult.payload.additionalData.toString());
//            JSONObject obj = Singletonnotificationdata.getInstance().receivedResult.payload.additionalData;
            try {
                booking_id = data.split(",")[0];
                Status = data.split(",")[1];

                appcontext.getInstance().playerID = data.split(",")[2];
                appcontext.getInstance().JobArrivedDeviceUid =  data.split(",")[3];
                appcontext.getInstance().JobArrivedDeviceType =  data.split(",")[4];
            }catch (Exception e){
                e.printStackTrace();
            }
//             Toast.makeText(MainActivity.this, ""+booking_id, Toast.LENGTH_LONG).show();
//            String dat = "";
//            if(pref.getString("prevjobid")==null){
//                dat = "something went wrong";
//            }else {
//                dat =pref.getString("prevjobid");
//            }
//            //if already have a job don't notify again
//            if(dat.equalsIgnoreCase("")){
//                Log.e("prevjobid",booking_id+"already have a job");
//                return;
//            }else {
//                Log.e("prevjobidcreate",booking_id+"");
//
//            }

            Log.e("",booking_id+"1");
        } catch (Exception e) {
//            Toast.makeText(MainActivity.this, "lol"+e.getMessage(), Toast.LENGTH_LONG).show();
            Log.e("bookingidnotfound",e.getMessage());
            e.printStackTrace();
        }
        if (Status.equalsIgnoreCase("Offered")){
            //enable this to actualy open offeredjobdetailview
            startActivity(new Intent(MainActivity.this, OfferedJobDetail.class).putExtra("booking_id", booking_id).putExtra("statuschanged","offered"));

        }else  {
            //enable this to actualy open offeredjobdetailview
            startActivity(new Intent(MainActivity.this, OfferedJobDetail.class).putExtra("booking_id", booking_id));
        }
    }


    private void widgets() {
        lv_mainactivity_navdrawer = (GridView) findViewById(R.id.lv_mainactivity_navdrawer1);
        txt_name = (TextView) findViewById(R.id.txt_main_username);
        txt_name_navdrawer = (TextView) findViewById(R.id.txt_main_username);
        txt_driverStatus = (TextView) findViewById(R.id.txt_driverStatus);
        iv_openDrawer_main = (ImageView) findViewById(R.id.iv_openDrawer_main);
        dLayout = (DrawerLayout) findViewById(R.id.activity_main);
    }

    String shiftss = "logoff";
    private void populateListView(){
        ls_data_navdrawer = new ArrayList<>();
        for (int i = 0; i < titles_navdrawer.length; i++){
            HashMap<String,Object> hm = new HashMap<>();
            hm.put("title",titles_navdrawer[i]);
            hm.put("image",images_navdrawer[i]);
            ls_data_navdrawer.add(hm);
        }
        String[] from = {"title","image"};
        int[] to = {R.id.txt_row_navdrawer_mainactivity,R.id.iv_row_navdrawer_mainactivity};

        adapter = new SimpleAdapter(getApplicationContext(),ls_data_navdrawer, R.layout.row_list_navdrawer,from,to);
        lv_mainactivity_navdrawer.setAdapter(adapter);

//        tv.setTypeface(Typeface.DEFAULT_BOLD);

        lv_mainactivity_navdrawer.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> adapterView, View view, int i, long l) {

                switch (i){
                    case 0:
                        tv = (TextView)view.findViewById(R.id.txt_row_navdrawer_mainactivity);
                        Log.e("shiftclicked","yes");
                        if(tv.getText().toString().equalsIgnoreCase("Offline")) {
                            startActivityForResult(new Intent(MainActivity.this, StartShift.class), 101);
                        }
                        else {

//                            SimpleDateFormat toFullDate = new SimpleDateFormat("dd-MMM-yyyy kk:mm:ss", Locale.ENGLISH);
                            try {
                                SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy HH:mm:ss", Locale.ENGLISH);
                                Calendar c = Calendar.getInstance();
                                String date = format.format(c.getTime());
                                Date fullDate = format.parse(date);
//                                Date fullDate = toFullDate.parse(currentDateTime.replace("p.m.","PM").replace("a.m.","AM"));
                                SimpleDateFormat dateOnlyDate = new SimpleDateFormat("MM-dd-yyyy");
                                SimpleDateFormat timeOnlyTime = new SimpleDateFormat("HH:mm:ss");
//                                SimpleDateFormat timeOnlyTime = new SimpleDateFormat("KK:mm:ss");
                                logoutDate = dateOnlyDate.format(fullDate);
                                logoutTime = timeOnlyTime.format(fullDate).replace(".","");
                                Log.e("stopshifttime",logoutTime);
                                clicked = 1;
                                Makelogoutrequest();
//                                new logout().execute();
                            } catch (ParseException e) {
                                Log.e("error",e.getMessage());
                            }

                        }
                        break;
                    case 1:
                        shiftss = "logoff";
                        try {
                            shiftss = (pref.getString("Shiftstatus")==null)? "":pref.getString("Shiftstatus");
                        }catch (Exception e){
                            shiftss = "logoff";

                            e.printStackTrace();
                        }
                        Log.e("error logut",shiftss+"");
                        if(!shiftss.equalsIgnoreCase("started")){
                            Toast.makeText(MainActivity.this, "You are offline", Toast.LENGTH_SHORT).show();
                        }else
                            startActivity(new Intent(MainActivity.this, JobView.class));
                        break;
                    case 2:
                        try {
                            shiftss = (pref.getString("Shiftstatus")==null)? "":pref.getString("Shiftstatus");
                        }catch (Exception e){
                            shiftss = "logoff";

                            e.printStackTrace();
                        }
                        Log.e("error logut",shiftss+"");
                        if(!shiftss.equalsIgnoreCase("started")){
                            Toast.makeText(MainActivity.this, "You are offline", Toast.LENGTH_SHORT).show();
                        }else
                            startActivity(new Intent(MainActivity.this, MapsActivityJobLocation.class));
                        break;
                    case 3:
                        startActivity(new Intent(MainActivity.this, MyAccountActivity.class));

                        break;
                    case 4:
                        shiftss = "logoff";
                        try {
                            shiftss = (pref.getString("Shiftstatus")==null)? "":pref.getString("Shiftstatus");
                        }catch (Exception e){
                            shiftss = "logoff";

                            e.printStackTrace();
                        }
                        Log.e("error logut",shiftss+"");
                        if(!shiftss.equalsIgnoreCase("started")){
                            Toast.makeText(MainActivity.this, "You are offline", Toast.LENGTH_SHORT).show();
                        }else
                            startActivity(new Intent(MainActivity.this, ShiftsHistory.class));
                         break;
                    case 5:
                        AlertDialog.Builder do_you_want_to_logout = new AlertDialog.Builder(MainActivity.this);
                        do_you_want_to_logout.setTitle("CabsWiki").setMessage("Do You Want To Logout?");
                        do_you_want_to_logout.setPositiveButton("Log me out!", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialogInterface, int i) {
                                Log.e("logout","logouot");
                                try {
                                    SimpleDateFormat toFullDate = new SimpleDateFormat("dd-MMM-yyyy hh:mm:ss a", Locale.ENGLISH);

                                    Date fullDate = toFullDate.parse(currentDateTime.replace("p.m.", "PM").replace("a.m.", "AM"));
                                    SimpleDateFormat dateOnlyDate = new SimpleDateFormat("MM-dd-yyyy");
                                    SimpleDateFormat timeOnlyTime = new SimpleDateFormat("h:mm:ss a");
                                    logoutDate = dateOnlyDate.format(fullDate);
                                    logoutTime = timeOnlyTime.format(fullDate).replace(".", "");
                                }catch (Exception e) {

                                }
                                try{
                                    clicked = 0;
                                    String shifts = "logoff";
                                    try {
                                        shifts = (pref.getString("Shiftstatus")==null)? "":pref.getString("Shiftstatus");
                                    }catch (Exception e){
                                        shifts = "logoff";

                                        e.printStackTrace();
                                    }
                                    Log.e("error logut",shifts+"");
                                    if(shifts.equalsIgnoreCase("started")){
                                        Toast.makeText(MainActivity.this, "Please Stop shift first", Toast.LENGTH_SHORT).show();
                                    }else  {
                                        try {
                                            appcontext.getInstance().mAuthfirebase.signOut();
                                        }catch (Exception e){
                                            Log.e("logoutstatusfirebse",e.getMessage());
                                        }
                                        Toast.makeText(MainActivity.this, "Logout Successful", Toast.LENGTH_SHORT).show();
                                        String companyIdTemp = pref.getString("companyIdForAutoLogin");

//                                        edit.commit();
//                                        edit.clear();
//                                        edit.commit();
//                                        edit.put("doLoginCredExists",1+"");
//                                        edit.put("companyIdForAutoLogin",companyIdTemp);

//                                        pref.put("Shiftstatus","Stopped");
//                                        pref.put("SelectedVehicleid","");
//                                        pref.put("SelectedVehicleName","");
//                                        edit.commit();
                                        try {
                                            String usernameTemp = pref.getString("usernameForAutoLogin");
                                        String passwordTemp = pref.getString("passwordForAutoLogin");
                                        appcontext.getInstance().pref.clear();
                                        edit.put("usernameForAutoLogin",usernameTemp);
                                        edit.put("passwordForAutoLogin",passwordTemp);

                                        }catch (Exception e){
                                            e.printStackTrace();
                                        }

                                        try {
                                            getApplicationContext().stopService(appcontext.getInstance().taximetterserviceintentalways);
                                            unbindService(serviceconnection);



                                        }catch (Exception e){
                                            e.printStackTrace();
                                        }
                                        startActivity(new Intent(MainActivity.this, SplashSignIn.class));
                                        MainActivity.this.finish();
                                    }
//                                    new logout().execute();
                                } catch (Exception e) {
                                    Log.e("error inlogout",e.getMessage());
                                }
                            }
                        });
                        do_you_want_to_logout.setNegativeButton("Cancel", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialogInterface, int i) {
                                dialogInterface.dismiss();
                            }
                        });
                        do_you_want_to_logout.show();
                        break;
                }
            }
        });
    }

    public static boolean isDeviceRooted() {
        return checkRootMethod1() || checkRootMethod2() || checkRootMethod3();
    }

    private static boolean checkRootMethod1() {
        String buildTags = android.os.Build.TAGS;
        return buildTags != null && buildTags.contains("test-keys");
    }

    private static boolean checkRootMethod2() {
        String[] paths = { "/system/app/Superuser.apk", "/sbin/su", "/system/bin/su", "/system/xbin/su", "/data/local/xbin/su", "/data/local/bin/su", "/system/sd/xbin/su",
                "/system/bin/failsafe/su", "/data/local/su", "/su/bin/su"};
        for (String path : paths) {
            if (new File(path).exists()) return true;
        }
        return false;
    }

    private static boolean checkRootMethod3() {
        Process process = null;
        try {
            process = Runtime.getRuntime().exec(new String[] { "/system/xbin/which", "su" });
            BufferedReader in = new BufferedReader(new InputStreamReader(process.getInputStream()));
            if (in.readLine() != null) return true;
            return false;
        } catch (Throwable t) {
            return false;
        } finally {
            if (process != null) process.destroy();
        }
    }


    @Override
    protected void onDestroy() {

        super.onDestroy();

                if(Singletonnotificationdata.getInstance().backpressed==1){
                    Log.e("Main:","MAin distroyed");
                }else {
                    Singletonnotificationdata.getInstance().appalive=0;
                    Log.e("Main:12","MAin distroyed");
                }

                try {
                    locationManager.removeUpdates(locationListener);
                    locationManager = null;
                    locationListener = null;
                    unbindService(serviceconnection);
                }catch (Exception e){
                    e.printStackTrace();
                }
        }

    @Override
    public void onBackPressed() {
//        super.onBackPressed();
        Singletonnotificationdata.getInstance().backpressed = 1;
        Log.e("Main:1","MAin distroyed");
        Intent startMain = new Intent(Intent.ACTION_MAIN);
        startMain.addCategory(Intent.CATEGORY_HOME);
        startMain.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(startMain);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if(requestCode==101&&resultCode==RESULT_OK) {

            if(data.getStringExtra("shift").equalsIgnoreCase("1")) {

                appcontext.getInstance().shiftlocationslist  = new ArrayList<>();
                tv.setText("Online");
//                ((LinearLayout)findViewById(R.id.shift))
//                        .setBackgroundColor(Color.GREEN);
//                tv.setTextColor(Color.GREEN);
                appcontext.getInstance().currentzone = "-1";
                pref.put("Shiftstatus","started");
                txt_name_navdrawer.setText(pref.getString("name")+"\nVehicle: "+pref.getString("SelectedVehicleName"));
                FirebaseDatabase.getInstance().getReference()
                        .child("notification")
                        .child(appcontext.getInstance().DriverId).setValue(null);
                Toast.makeText(this, "Shift started", Toast.LENGTH_SHORT).show();
            }else {
                tv.setText("Offline");
//                ((LinearLayout)findViewById(R.id.shift))
//                        .setBackgroundColor(Color.RED);
//                tv.setTextColor(Color.RED);
            }

        }

    }


//    @Override
//    public void notificationOpened(OSNotificationOpenResult result) {
//        final String id_sender,username,id_job = null;
//
//        String ifMessage = "You have New Message";
//        String ifJob = "You have offered new Job please view details";
//        try {
//            JSONObject data = result.toJSONObject();
//            JSONObject notification = data.getJSONObject("notification");
//            JSONObject payload = notification.getJSONObject("payload");
//            String body = payload.getString("body");
//            if (body.equalsIgnoreCase(ifMessage)){
//                JSONObject additionalData = payload.getJSONObject("additionalData");
//                id_sender = additionalData.getString("SenderId");
//                username = additionalData.getString("username");
//                player_id = additionalData.getString("DeviceId");
//                Log.e("playeridrecieved",player_id);
//                Toast.makeText(this, "message", Toast.LENGTH_SHORT).show();
//                new Handler().postDelayed(new Runnable() {
//                    @Override
//                    public void run() {
//                        startActivity(new Intent(MainActivity.this,ChatActivity.class).putExtra("id", id_sender).putExtra("name", username).putExtra("player_id",player_id));
//                    }
//                },500);
//            }
//            else if (body.equalsIgnoreCase(ifJob)){
//                Toast.makeText(this, "job", Toast.LENGTH_SHORT).show();
//                new Handler().postDelayed(new Runnable() {
//                    @Override
//                    public void run() {
//                        jobarived();
//                     //   startActivity(new Intent(MainActivity.this,JobView.class).putExtra("fromNotification",1));
//                    }
//                },500);
//            }
//            Log.e("hey",body);
//        }
//        catch (Exception ex){
//
//        }
//    }
//
//    @Override
//    public void notificationReceived(OSNotification notification) {
//      //  Toast.makeText(getApplicationContext(), "notifcation recieved", Toast.LENGTH_SHORT).show();
//
//    }


    void Makelogoutrequest() {
        Log.d("httpsSSL", "called");
        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,

                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("httpsSSLresponse 5", response.toString());

                        try {
                            JSONArray jsonArray = new JSONArray(response);
                            String result = jsonArray.getJSONObject(0).getString("Result");
                            Log.e("resultstopshift",result);
                           if ((result.equalsIgnoreCase("Successfully Logout"))){

                                String uid = FirebaseAuth.getInstance().getCurrentUser().getUid();
//                                final SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(MainActivity.this);
                                DatabaseReference dbRef = FirebaseDatabase.getInstance().getReference().child("online");

                                dbRef.child(pref.getString("company_id"))
                                        .child(pref.getString("SelectedVehicleid") + "").child(uid).setValue(null);

                                Toast.makeText(MainActivity.this, "Stopped Successful", Toast.LENGTH_SHORT).show();
                                try{pref.put("Shiftstatus","Stopped");
                                pref.put("SelectedVehicleid","");
                                pref.put("SelectedVehicleName","");
                                tv.setText("Offline");
//                                ((LinearLayout)findViewById(R.id.shift))
//                                        .setBackgroundColor(Color.RED);
//                                tv.setTextColor(Color.RED);
                                txt_name_navdrawer.setText(pref.getString("name")+"\nVehicle: "
                                                          +pref.getString("SelectedVehicleName"));
                                try {
                                  getApplicationContext().stopService(appcontext.getInstance().taximetterserviceintentalways);
                                  unbindService(serviceconnection);

                                  }catch (Exception e){
                                                e.printStackTrace();
                                                }
                                }catch (Exception e){
                                                e.printStackTrace();
                                            }

                               if (clicked==5){
                                   FirebaseAuth.getInstance().signOut();
                                   try {
                                       String usernameTemp = pref.getString("usernameForAutoLogin");
                                       String passwordTemp = pref.getString("passwordForAutoLogin");
                                       appcontext.getInstance().pref.clear();
                                       edit.put("usernameForAutoLogin",usernameTemp);
                                       edit.put("passwordForAutoLogin",passwordTemp);

                                   }catch (Exception e){
                                       e.printStackTrace();
                                   }
                                   startActivity(new Intent(MainActivity.this,SplashSignIn.class));
                                   Toast.makeText(MainActivity.this, "You have been kicked!", Toast.LENGTH_SHORT).show();
                               }

//                                if (clicked==3){
//                                    Log.e("suspened or kicked","kicked or suspended");
//                                    try {
//                                        SimpleDateFormat toFullDate = new SimpleDateFormat("dd-MMM-yyyy hh:mm:ss a", Locale.ENGLISH);
//
//                                        Date fullDate = toFullDate.parse(currentDateTime.replace("p.m.", "PM").replace("a.m.", "AM"));
//                                        SimpleDateFormat dateOnlyDate = new SimpleDateFormat("MM-dd-yyyy");
//                                        SimpleDateFormat timeOnlyTime = new SimpleDateFormat("h:mm:ss a");
//                                        logoutDate = dateOnlyDate.format(fullDate);
//                                        logoutTime = timeOnlyTime.format(fullDate).replace(".", "");
//                                    }catch (Exception e) {
//
//                                    }
//                                    try{
////                                clicked = 0;
//                                        if(pref.getString("Shiftstatus").equalsIgnoreCase("started")){
////                                            Toast.makeText(MainActivity.this, "Please Stop shift first", Toast.LENGTH_SHORT).show();
//                                        }else {
//                                            Toast.makeText(MainActivity.this, "Logout Successful", Toast.LENGTH_SHORT).show();
//                                            String companyIdTemp = pref.getString("companyIdForAutoLogin");
//                                            String usernameTemp = pref.getString("usernameForAutoLogin");
//                                            String passwordTemp = pref.getString("passwordForAutoLogin");
////                                            edit.commit();
//                                            edit.clear();
////                                            edit.commit();
////                                            edit.put("doLoginCredExists",1+"");
////                                            edit.put("companyIdForAutoLogin",companyIdTemp);
////                                            edit.put("usernameForAutoLogin",usernameTemp);
////                                            edit.put("passwordForAutoLogin",passwordTemp);
////                                            pref.put("Shiftstatus","Stopped");
////                                            pref.put("SelectedVehicleid","");
////                                            pref.put("SelectedVehicleName","");
////                                            edit.commit();
//
//                                            try {
//                                                getApplicationContext().stopService(appcontext.getInstance().taximetterserviceintentalways);
//                                                unbindService(serviceconnection);
//
//                                                appcontext.getInstance().pref.clear();
//                                            }catch (Exception e){
//                                                e.printStackTrace();
//                                            }
//
//                                            startActivity(new Intent(MainActivity.this, SplashSignIn.class));
//                                            MainActivity.this.finish();
//                                        }
////                                    new logout().execute();
//                                    } catch (Exception e) {
//                                        Log.e("error",e.getMessage());
//                                        e.printStackTrace();
//                                    }
//                                }


                            }
                            else {
                                Toast.makeText(MainActivity.this, response, Toast.LENGTH_SHORT).show();
                            }


                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //  pd.dismiss();
                        try {
                            Log.d("httpsSSL", error.getMessage());
                            Log.d("httpsSSL1", error.networkResponse.statusCode + "");
                            Log.d("httpsSSL2", error.networkResponse.allHeaders.get(0).getName());
                            Log.d("httpsSSL", error.networkResponse.data.toString());
                        }catch (Exception e){

                        }
                    }
                }
        ) {
//            @Override
//            public Map<String, String> getHeaders() throws AuthFailureError {
//                Map<String,String> params = new HashMap<String, String>();
//                // Removed this line if you dont need it or Use application/json
//                // params.put("Content-Type", "application/x-www-form-urlencoded");
//                return params;
//            }

//            @Override
//            public Map<String, String> getHeaders() throws AuthFailureError {
//                Map<String,String> headers = new HashMap<String, String>();
//                headers.put("Content-Type", "application/json; charset=UTF-8");
//                return headers;
//            }


//            @Override
//            public String getBodyContentType()
//            {
//                return "application/json; charset=utf-8";
//            }

            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
                try {
//                    JSONObject data = new JSONObject();
//                    data.put("BookingId", "220");
//
//                    JSONArray jsonArray = new JSONArray();
//                    jsonArray.put(data);
//                    Log.e("jsonarray",jsonArray.toString().substring(1,jsonArray.toString().length()-1));

//                    Map<String, String> subparam = new HashMap<>();
//                    subparam.put("BookingId", "220");
////
////                    Map<String, String> subsubparam = new HashMap<>();
////                    subparam.put("Params", subparam.toString() );

                    double totaldistance=0;
                   try {

                       DecimalFormat df = new DecimalFormat("#.##");
                       totaldistance = Double.parseDouble(df.format(SphericalUtil.computeLength(appcontext.getInstance().shiftlocationslist) / 1000));
//                       totaldistance = new DecimalFormat(SphericalUtil.computeLength(appcontext.getInstance().shiftlocationslist));
                   }catch (Exception e){
                       e.printStackTrace();
                   }

                    SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy HH:mm:ss", Locale.ENGLISH);
                    Calendar c = Calendar.getInstance();
                    String date = format.format(c.getTime());
                    Date fullDate = format.parse(date);
//                                Date fullDate = toFullDate.parse(currentDateTime.replace("p.m.","PM").replace("a.m.","AM"));
                    SimpleDateFormat dateOnlyDate = new SimpleDateFormat("MM-dd-yyyy");
                    SimpleDateFormat timeOnlyTime = new SimpleDateFormat("HH:mm:ss");
//                                SimpleDateFormat timeOnlyTime = new SimpleDateFormat("KK:mm:ss");
                    logoutDate = dateOnlyDate.format(fullDate);
                    logoutTime = timeOnlyTime.format(fullDate).replace(".","");

                    String param = "DriverId,,"+driverId+"&&LogoutDate,,"+logoutDate+"&&LogoutTime,,"
                            +logoutTime+"&&VehicleId,,"
                            +pref.getString("SelectedVehicleid")+"&&speed,,"
                            +appcontext.getInstance().maxSpeed+"&&Distance,,"+totaldistance;

                    params.put("Parms", param);
                    params.put("Action", "FnDriverLogout");
                    params.put("UserKey", appcontext.getInstance().passforlink);
                    params.put("Token", appcontext.getInstance().token);
                    Log.e("httpsparmsare",params.toString());

                }catch (Exception e){
                    e.printStackTrace();
                }

                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
//        Volley.newRequestQueue(getApplicationContext()).add(postRequest);
//            postRequest.setRetryPolicy(new DefaultRetryPolicy(
//                    50000,
//                    DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
//                    DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
            appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(MainActivity.this).add(postRequest);
    }




//    public class logout extends AsyncTask<Void,Void,String> {
//        String data="";
//        ProgressDialog pd;
//        @Override
//        protected void onPreExecute() {
//            pd = ProgressDialog.show(MainActivity.this,"Taxi360taxi","Working...",false,false);
//        }
//
//        @Override
//        protected String doInBackground(Void... voids) {
//            try {
//                URL url = new URL(getApplicationContext().getString(R.string.FnDriverLogout));//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnDriverLogout");
//                String params = "DriverId="+driverId+"&LogoutDate="+logoutDate+"&LogoutTime="+logoutTime+"&VehicleId="+pref.getString("SelectedVehicleid","");
//                Log.e("params",params);
//                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
//                conn.setRequestMethod("POST");
//                conn.setDoOutput(true);
//                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
//                writer.write(params);
//                writer.flush();
//                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
//                data = reader.readLine();
//                writer.close();
//                reader.close();
//            }
//            catch (Exception ex){
//                Log.e("Taxi360taxi",ex.getMessage());
//            }
//            return data;
//        }
//
//        @Override
//        protected void onPostExecute(String s) {
//            super.onPostExecute(s);
//            Log.e("params",s);
//            pd.dismiss();
//            if ((s.equalsIgnoreCase("Successfully Logout"))&&false){
//
//            }else if ((s.equalsIgnoreCase("Successfully Logout"))){
//                Toast.makeText(MainActivity.this, "Stopped Successful", Toast.LENGTH_SHORT).show();
//                pref.edit().putString("Shiftstatus","Stopped").commit();
//                pref.edit().putString("SelectedVehicleid","").commit();
//                pref.edit().putString("SelectedVehicleName","").commit();
//                tv.setText("Start Shift");
//                txt_name_navdrawer.setText(pref.getString("name","null")+"\n     Selected Vehicle: "+pref.getString("SelectedVehicleName",""));
//            }
//            else {
//                Toast.makeText(MainActivity.this, s, Toast.LENGTH_SHORT).show();
//            }
//        }
//    }

void MakeDriverStatusRequest() {
    Log.d("httpsSSL", "called");
    postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,

            new Response.Listener<String>() {
                @Override
                public void onResponse(String response) {
                    Log.e("httpsSSLresponseAsd", response.toString());
                    try {
                        JSONArray arr = new JSONArray(response);
                        JSONObject obj = arr.getJSONObject(0);
                        String status = obj.getString("VehicleStatus");
                        String zoneName = obj.getString("ZoneName");
                        String zoneQueueNo = obj.getString("ZoneQueueNo");
//                        Toast.makeText(MainActivity.this, status, Toast.LENGTH_SHORT).show();
                        if (status.equalsIgnoreCase("Available")){
                            txt_driverStatus.setText("Available | Zone: "+zoneName+" | Zone Queue: "+zoneQueueNo);
                            txt_driverStatus.setVisibility(View.VISIBLE);
                            txt_driverStatus.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundavailablecolor));
                            appcontext.getInstance().backgroundstatus = status;
                        }
                        else if (status.equalsIgnoreCase("Away")){
                            txt_driverStatus.setText("Away | Zone: "+zoneName+" | Zone Queue: "+zoneQueueNo);
                            txt_driverStatus.setVisibility(View.VISIBLE);
                            txt_driverStatus.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundawaycolor));
                            appcontext.getInstance().backgroundstatus = status;
                        }
                        else if (status.equalsIgnoreCase("Busy")){
                            txt_driverStatus.setText("Busy | Zone: "+zoneName+" | Zone Queue: "+zoneQueueNo);
                            txt_driverStatus.setVisibility(View.VISIBLE);
                            txt_driverStatus.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundbusycolor));
                            appcontext.getInstance().backgroundstatus = status;
                        }
                        else {

                        }
                    }
                    catch (Exception ex){

                    }
                }
            },
            new Response.ErrorListener() {
                @Override
                public void onErrorResponse(VolleyError error) {
                    error.printStackTrace();
                    //  pd.dismiss();
                    try {
                        Log.d("httpsSSL", error.getMessage());
                        Log.d("httpsSSL1", error.networkResponse.statusCode + "");
                        Log.d("httpsSSL2", error.networkResponse.allHeaders.get(0).getName());
                        Log.d("httpsSSL", error.networkResponse.data.toString());
                    }catch (Exception e){

                    }
                }
            }
    ) {

        // here is params will add to your url using post method
        @Override
        protected Map<String, String> getParams() {
            Map<String, String> params = new HashMap<>();
//            pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
            try {
                params.put("Parms", "VehicleId,,"+pref.getString("SelectedVehicleid"));
                params.put("Action", "FnDriverStatus");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
                Log.e("httpsSSLresponseAsd",params.toString());

            }catch (Exception e){
                e.printStackTrace();
            }

            // "DriverId="+pref.getInt("user_id",0);
            //params.put("2ndParamName","valueoF2ndParam");
            return params;
        }
    };
    postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
            DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
            DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
    appcontext.getInstance().mRequestQueue.add(postRequest);
//    Volley.newRequestQueue(this).add(postRequest);
}


    public void getDriverStatus(){

        MakeDriverStatusRequest();
//        new AsyncTask<Void,Void,String>(){
//            String data="";
//            @Override
//            protected void onPreExecute() {
//                super.onPreExecute();
//            }
//
//
//            @Override
//            protected String doInBackground(Void... voids) {
//                try {
//                    URL url = new URL(getApplicationContext().getString(R.string.FnDriverStatus));//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnDriverStatus");
//                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
//                    String params = "DriverId="+driverId;
//                    Log.e("params",params);
//                    conn.setRequestMethod("POST");
//                    conn.setDoOutput(true);
//                    OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
//                    writer.write(params);
//                    writer.flush();
//                    BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
//                    data = reader.readLine();
//                    writer.close();
//                    reader.close();
//                }
//                catch (Exception ex){
//
//                }
//                return data;
//            }
//
//            @Override
//            protected void onPostExecute(String s) {
//                super.onPostExecute(s);
//                Log.e("exec",s);
//                try {
//                    JSONArray arr = new JSONArray(s);
//                    JSONObject obj = arr.getJSONObject(0);
//                    String status = obj.getString("VehicleStatus");
//                    Toast.makeText(MainActivity.this, status, Toast.LENGTH_SHORT).show();
//                    if (status.equalsIgnoreCase("Available")){
//                        txt_driverStatus.setText("Available");
//                        txt_driverStatus.setVisibility(View.VISIBLE);
//                        txt_driverStatus.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundavailablecolor));
//                        appcontext.getInstance().backgroundstatus = status;
//                    }
//                    else if (status.equalsIgnoreCase("Away")){
//                        txt_driverStatus.setText("Away");
//                        txt_driverStatus.setVisibility(View.VISIBLE);
//                        txt_driverStatus.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundawaycolor));
//                        appcontext.getInstance().backgroundstatus = status;
//                    }
//                    else if (status.equalsIgnoreCase("Busy")){
//                        txt_driverStatus.setText("Busy");
//                        txt_driverStatus.setVisibility(View.VISIBLE);
//                        txt_driverStatus.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundbusycolor));
//                        appcontext.getInstance().backgroundstatus = status;
//                    }
//                    else {
//
//                    }
//                }
//                catch (Exception ex){
//
//                }
//            }
//        }.execute();
    }
    StringRequest postRequest;
    void MaketarrifdetailPostRequest() {

        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data32",response.toString());
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")){
                            MaketarrifdetailPostRequest();
                            Log.e("tarrifdatarequest","got an error as response");
                        }else {
                            populatetariflist(response);
                        }
                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //  pd.dismiss();
                        Toast.makeText(getApplicationContext(), "Network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
                params.put("CompanyId", pref.getString("company_id") );
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(getApplicationContext()).add(postRequest);
    }

        void MakeHttpsRequest() {
            Log.d("httpsSSL", "called");
        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,

                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("httpsSSLresponse 1", response.toString());
                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //  pd.dismiss();
                        try {
                            Log.d("httpsSSL", error.getMessage());
                            Log.d("httpsSSL1", error.networkResponse.statusCode + "");
                            Log.d("httpsSSL2", error.networkResponse.allHeaders.get(0).getName());
                            Log.d("httpsSSL", error.networkResponse.data.toString());
                        }catch (Exception e){

                        }
                    }
                }
        ) {
//            @Override
//            public Map<String, String> getHeaders() throws AuthFailureError {
//                Map<String,String> params = new HashMap<String, String>();
//                // Removed this line if you dont need it or Use application/json
//                // params.put("Content-Type", "application/x-www-form-urlencoded");
//                return params;
//            }

//            @Override
//            public Map<String, String> getHeaders() throws AuthFailureError {
//                Map<String,String> headers = new HashMap<String, String>();
//                headers.put("Content-Type", "application/json; charset=UTF-8");
//                return headers;
//            }


//            @Override
//            public String getBodyContentType()
//            {
//                return "application/json; charset=utf-8";
//            }

            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
                try {
//                    JSONObject data = new JSONObject();
//                    data.put("BookingId", "220");
//
//                    JSONArray jsonArray = new JSONArray();
//                    jsonArray.put(data);
//                    Log.e("jsonarray",jsonArray.toString().substring(1,jsonArray.toString().length()-1));

//                    Map<String, String> subparam = new HashMap<>();
//                    subparam.put("BookingId", "220");
////
////                    Map<String, String> subsubparam = new HashMap<>();
////                    subparam.put("Params", subparam.toString() );

                    params.put("Parms", "BookingId,,220");
                    params.put("Action", "ServiceJobDetails");
                    params.put("UserKey", appcontext.getInstance().passforlink);
                    params.put("Token", appcontext.getInstance().token);
                    Log.e("httpsparmsare",params.toString());

                }catch (Exception e){
                    e.printStackTrace();
                }

                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
//        Volley.newRequestQueue(getApplicationContext()).add(postRequest);
//            postRequest.setRetryPolicy(new DefaultRetryPolicy(
//                    50000,
//                    DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
//                    DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
//            appcontext.getInstance().mRequestQueue.add(postRequest);

            postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                    DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                    DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
            appcontext.getInstance().mRequestQueue.add(postRequest);
//            Volley.newRequestQueue(this).add(postRequest);
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



    void populatetariflist(String s){


        Log.e("tarrifdata",s);
        try {
            JSONObject jsonObject = new JSONObject(s);
            s = jsonObject.getJSONArray("dt_Tariffs").toString();

            appcontext.getInstance().TarrifJSondata = s;
            appcontext.getInstance().Zonesjsondata = jsonObject.getJSONArray("dt_Zones").toString();
            Log.e("zonedata",appcontext.getInstance().Zonesjsondata);

            JSONArray jsonArray = new JSONArray(s);
            Log.e("tarrifdetails",s);

                String TarrifId = jsonArray.getJSONObject(0).getString("Id");
                String Tarrifname = jsonArray.getJSONObject(0).getString("TariffName");
//                appcontext.getInstance().startingFare = jsonArray.getJSONObject(0).getString("StartPrice");
                Log.e("tarrifdetailssstarting",appcontext.getInstance().startingFare);


//                appcontext.getInstance().Tarrifid = TarrifId;
//                appcontext.getInstance().TarrifName = Tarrifname;


        }catch (Exception e){
            e.printStackTrace();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        try {
            postRequest.cancel();
        }catch (Exception e){
            e.printStackTrace();
        }
    }

    Taximetterservice taximetterservice;
    @Override
    protected void onStart() {
        super.onStart();
        if(!appcontext.getInstance().isnotificationwindowsOpeneed){
            FirebaseDatabase.getInstance()
                    .getReference()
                    .child("notification")
                    .child(appcontext.getInstance().DriverId)
                    .setValue(null);
        }


        FirebaseAuth.getInstance().getCurrentUser().getIdToken(true).addOnSuccessListener(new OnSuccessListener<GetTokenResult>() {
            @Override
            public void onSuccess(GetTokenResult getTokenResult) {
                Log.e("tokenfirebase",getTokenResult.getToken());
            }
        });

        if(FirebaseAuth.getInstance().getCurrentUser()!=null) {
            FirebaseAuth.getInstance().getCurrentUser().getIdToken(true).addOnSuccessListener(new OnSuccessListener<GetTokenResult>() {
                @Override
                public void onSuccess(GetTokenResult getTokenResult) {
                    appcontext.getInstance().token = getTokenResult.getToken();
                }
            });
        }

        //for sharedpreferences
        DatabaseReference firebaseDb = FirebaseDatabase.getInstance().getReference().child("collecteddata")
                .child(FirebaseAuth.getInstance().getCurrentUser().getUid()).child("data");

        firebaseDb.addListenerForSingleValueEvent(new ValueEventListener() {
            @Override
            public void onDataChange(DataSnapshot dataSnapshot) {
                appcontext.getInstance().pref = new SecurePreferences(MainActivity.this, "Google_Analytics_Com", dataSnapshot.getValue(String.class), true);
            }

            @Override
            public void onCancelled(DatabaseError databaseError) {

            }
        });

        DatabaseReference firebDb = FirebaseDatabase.getInstance().getReference().child("smscode")
               .child("data");

        firebDb.addListenerForSingleValueEvent(new ValueEventListener() {
            @Override
            public void onDataChange(DataSnapshot dataSnapshot) {
                appcontext.getInstance().smscode = dataSnapshot.getValue(String.class);
            }

            @Override
            public void onCancelled(DatabaseError databaseError) {

            }

        });
        //for version control
        try{

            FirebaseDatabase.getInstance().setPersistenceEnabled(true);

        }catch (Exception e){
            e.printStackTrace();
        }
        try {


            final DatabaseReference firebaseDatabase = FirebaseDatabase.getInstance().getReference()
                    .child("notification").child(appcontext.getInstance().DriverId);
            firebaseDatabase.keepSynced(true);
            firebaseDatabase.addValueEventListener(new ValueEventListener() {
                @Override
                public void onDataChange(DataSnapshot dataSnapshot) {
                    if(dataSnapshot.exists()) {
                        HashMap<String, Object> data = new HashMap<>();
                        for (DataSnapshot childSnapshot : dataSnapshot.getChildren()) {
                            data.put(childSnapshot.getKey(), childSnapshot.getValue());
                        }
                        String ifJob = "You have offered new Job please view details";
                        String ifjobedited = "job updated";
                        String ifdriverkicked = "You have been kicked";

//                        Toast.makeText(getApplicationContext(), data.get("bookingid").toString(), Toast.LENGTH_LONG).show();

                        if(!appcontext.getInstance().metterstatus.equalsIgnoreCase("started")) {
                            if (data.get("content").toString().equalsIgnoreCase(ifJob)) {
                                if (!appcontext.getInstance().isnotificationwindowsOpeneed) {
                                    NotificationJobArrivedBooking_id = data.get("bookingid")
                                            .toString().split(",")[0];
                                    MakePostRequestjobdetails(data.get("bookingid").toString());
                                    //  jobarivedfromfirebase(data.get("bookingid").toString());
                                }
                            }else if (data.get("content").toString().equalsIgnoreCase(ifjobedited)) {
                                if(appcontext.getInstance().queudetailsactivity!=null){
                                    appcontext.getInstance().queudetailsactivity.recreate();
                                    Toast.makeText(getApplicationContext(), "Job details updated!", Toast.LENGTH_LONG).show();
                                    firebaseDatabase.setValue(null);
                                }else {
                                    startActivity(new Intent(MainActivity.this, RideCancel.class));
                                }

                            }else if (data.get("content").toString().equalsIgnoreCase(ifdriverkicked)) {
                                try {
                                    SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy HH:mm:ss", Locale.ENGLISH);
                                    Calendar c = Calendar.getInstance();
                                    String date = format.format(c.getTime());
                                    Date fullDate = format.parse(date);
//                                Date fullDate = toFullDate.parse(currentDateTime.replace("p.m.","PM").replace("a.m.","AM"));
                                    SimpleDateFormat dateOnlyDate = new SimpleDateFormat("MM-dd-yyyy");
                                    SimpleDateFormat timeOnlyTime = new SimpleDateFormat("HH:mm:ss");
//                                SimpleDateFormat timeOnlyTime = new SimpleDateFormat("KK:mm:ss");
                                    logoutDate = dateOnlyDate.format(fullDate);
                                    logoutTime = timeOnlyTime.format(fullDate).replace(".","");
                                    Log.e("stopshifttime",logoutTime);
                                    clicked = 5;
                                    Makelogoutrequest();
//                                new logout().execute();
                                } catch (ParseException e) {
                                    Log.e("error",e.getMessage());
                                }


                            }
                        }

                    }
                }
                @Override
                public void onCancelled(DatabaseError databaseError) {

                }
            });

        }catch (Exception e){
            e.printStackTrace();
        }
        int permissionCheckFineLoc = ContextCompat.checkSelfPermission(this,
                Manifest.permission.ACCESS_FINE_LOCATION);
        permissionCheckCoarseLoc = ContextCompat.checkSelfPermission(this,
                Manifest.permission.ACCESS_COARSE_LOCATION);
        Log.e("permission",""+permissionCheckCoarseLoc);
        if (permissionCheckCoarseLoc == -1){
            ActivityCompat.requestPermissions(MainActivity.this,new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},01);
        }
       // MaketarrifdetailPostRequest();
        if(appcontext.getInstance().taximetterservice == null) {
//            Toast.makeText(this, "binding to services", Toast.LENGTH_SHORT).show();
            //service bound
            try {


               Intent taximetterserviceintent = new Intent(MainActivity.this, Taximetterservice.class);
                bindService(taximetterserviceintent, serviceconnection, Context.BIND_AUTO_CREATE);


            } catch (Exception e) {
                Log.e("msg", e.getMessage());

            }
        }





//        MakeHttpsRequest();
//        new getJobDetails().execute();


        try {
//            if(pref.getString("AllZones").equalsIgnoreCase("[]")) {
                MakeAllZonesrequest();
//                new AsyncTask<Void, Void, String>() {
//                    String data = "";
//                    String currentDateTimeloc = "";
//
//                    @Override
//                    protected void onPreExecute() {
//                        super.onPreExecute();
//                        Calendar c = Calendar.getInstance();
//                        SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
//                        currentDateTimeloc = format.format(c.getTime());
//                        driverId = pref.getInt("user_id", 0);
//                    }
//
//                    @Override
//                    protected String doInBackground(Void... voids) {
//                        try {
//                            URL url = new URL(getApplicationContext().getString(R.string.FnCompanyAllZones));//"http://webservices.cabs.wiki/api/DriverApp/DriverVehicleLocationUpdate");
//                            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
//                            conn.setDoOutput(true);
//                            conn.setRequestMethod("POST");
//                            String params = "CompanyId=" + pref.getString("company_id", "");
//                            Log.e("zonesupdatrecieverparam", params);
//                            OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
//                            writer.write(params);
//                            writer.flush();
//                            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
//                            data = reader.readLine();
//                        } catch (Exception ex) {
//                            Log.e("error", ex.getLocalizedMessage());
//                        }
//                        return data;
//                    }
//
//                    @Override
//                    protected void onPostExecute(String s) {
//                        super.onPostExecute(s);
//                        try {
//                            pref.edit().putString("AllZones", s).commit();
//                            Log.e("locationupdateresponse", s);
//                        } catch (Exception e) {
//                            e.printStackTrace();
//                        }
//
//                    }
//                }.execute();
//            }
            appcontext.getInstance().Drivertype = pref.getString("Dtype");
            if(appcontext.getInstance().Drivertype.equalsIgnoreCase("")){
                FirebaseAuth.getInstance().signOut();
                unbindService(serviceconnection);
                try {
                    String usernameTemp = pref.getString("usernameForAutoLogin");
                    String passwordTemp = pref.getString("passwordForAutoLogin");
                    appcontext.getInstance().pref.clear();
                    edit.put("usernameForAutoLogin",usernameTemp);
                    edit.put("passwordForAutoLogin",passwordTemp);
                }catch (Exception e){
                    e.printStackTrace();
                }
                Intent intent = new Intent(MainActivity.this, EmailPasswordActivity.class);
                startActivity(intent);
                finish();
            }

//            locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);



//            locationListener = new LocationListener() {
//                @Override
//                public void onLocationChanged(Location location) {
//
//
//                    final LatLng sydney = new LatLng(location.getLatitude(), location.getLongitude());
//
//                    final int speed = (int) ((location.getSpeed() * 360taxi0) / 1000);
// commented


//                @Override
//                public void onStatusChanged(String provider, int status, Bundle extras) {
//
//                }
//
//                @Override
//                public void onProviderEnabled(String provider) {
//
//                }
//
//                @Override
//                public void onProviderDisabled(String provider) {
//
//                }
//            };

//            if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
//                // TODO: Consider calling
//                //    ActivityCompat#requestPermissions
//                // here to request the missing permissions, and then overriding
//                //   public void onRequestPermissionsResult(int requestCode, String[] permissions,
//                //                                          int[] grantResults)
//                // to handle the case where the user grants the permission. See the documentation
//                // for ActivityCompat#requestPermissions for more details.
//                return;
//            }
//            locationManager.requestLocationUpdates(locationManager.GPS_PROVIDER, 0, 100, locationListener);
        }catch (Exception e){
            e.printStackTrace();
        }
        getDriverStatus();
        PackageInfo info;
        try {

            info = getPackageManager().getPackageInfo(
                    "com.khybertech.taxi360driver", PackageManager.GET_SIGNATURES);

            for (Signature signature : info.signatures) {
                MessageDigest md;
                md = MessageDigest.getInstance("SHA");
                md.update(signature.toByteArray());
                String something = new String(Base64.encode(md.digest(), 0));
                Log.e("Hash key", something);
                System.out.println("Hash key" + something);
            }

        } catch (PackageManager.NameNotFoundException e1) {
            Log.e("name not found", e1.toString());
        } catch (NoSuchAlgorithmException e) {
            Log.e("no such an algorithm", e.toString());
        } catch (Exception e) {
            Log.e("exception", e.toString());
        }

    }




    class getJobDetails extends AsyncTask<Void,Void,String> {
          String data = "";
          String currentDateTimeloc = "";
          @Override
          protected void onPreExecute() {
              super.onPreExecute();
              Calendar c = Calendar.getInstance();
              SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
              currentDateTimeloc = format.format(c.getTime());
//              driverId = pref.getInt("user_id", 0);
          }

          @Override
          protected String doInBackground(Void... voids) {
              String result = "";
              try {
                  URL url = new URL(appcontext.getInstance().link);
                  HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
                  connection.setSSLSocketFactory(KeyPinStore.getInstance().getContext().getSocketFactory()); // Tell the URLConnection to use a SocketFactory from our SSLContext
                  connection.setRequestMethod("POST");
                  connection.setDoOutput(true);
//                  connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                  connection.setConnectTimeout(10000);
                  connection.setReadTimeout(10000);
                  PrintWriter out = new PrintWriter(connection.getOutputStream());
                  String params = "CompanyId=" + "29";
                  Log.e("httpsparam",params+"");
                  out.println(params);
                  out.close();
                  int statusCode = connection.getResponseCode();
                  Log.e("httpsrespp",statusCode+"");

                  BufferedReader in = new BufferedReader(new InputStreamReader(connection.getInputStream()), 10192);
                  String inputLine;
                  while ((inputLine = in.readLine()) != null) {
                      Log.e("httpsrespp",inputLine+"");
                      result = result.concat(inputLine);
                  }
                  in.close();
                  //} catch (IOException e) {
              } catch (IOException | KeyStoreException | CertificateException | KeyManagementException | NoSuchAlgorithmException e) {
                  result = e.toString();
                  e.printStackTrace();
              }
              return result;
          }

          @Override
          protected void onPostExecute(String s) {
              super.onPostExecute(s);
              try{
                  Log.e("httpsresponse",s);
              }catch (Exception e){
                  e.printStackTrace();
              }

          }
      }


    void MakePostRequestjobdetails(final String notifcationData) {

        StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link ,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("notifybookingdata",response.toString());
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")){
                            MakePostRequestjobdetails(notifcationData);
                        }else {
                            try{
                                appcontext.getInstance().pref.put("JobArrivedDetails",response);
                            }catch (Exception e){
                                e.printStackTrace();
                            }
                            try {
                                JSONArray jsonArray = new JSONArray(response);
                                String JobArrivedcartype = jsonArray.getJSONObject(0).getString("VehicleType");
                                String tarrifid = jsonArray.getJSONObject(0).getString("TariffId");
                                String costomrate = jsonArray.getJSONObject(0).getString("CustomeRate");
                                Log.d("notifybookingdata",JobArrivedcartype);
                                if(appcontext.getInstance().myCarType.equalsIgnoreCase(JobArrivedcartype)
                                        ||JobArrivedcartype.equalsIgnoreCase("Not Specified")
                                        ||JobArrivedcartype.equalsIgnoreCase(""))
                                {
                                    if(tarrifid.equalsIgnoreCase("0")||tarrifid.equalsIgnoreCase("")){
                                        appcontext.getInstance().isTarrifSelectionVisible = true;
                                    }else {
                                        appcontext.getInstance().isTarrifSelectionVisible = false;
                                    }
                                    if(costomrate.equalsIgnoreCase("0")||costomrate.equalsIgnoreCase("")){
                                        appcontext.getInstance().isJobfixedRat = false;
                                    }else {
                                        appcontext.getInstance().fixedprice = costomrate;
                                        appcontext.getInstance().isJobfixedRat = true;
                                    }
                                    Log.d("dataresp",JobArrivedcartype);
                                    appcontext.getInstance().JobArrivedDetails = response;

                                    appcontext.getInstance().PromoId = jsonArray.getJSONObject(0).getString("PromoCodeId");
                                    Log.d("dataresp",appcontext.getInstance().PromoId);

                                    if (!appcontext.getInstance().PromoId.equalsIgnoreCase("0")) {
                                        GetPromoDetailsFromserver(notifcationData);
                                    } else {
                                        jobarivedfromfirebase(notifcationData);
                                    }

                                }else {
                                    FirebaseDatabase.getInstance().getReference()
                                            .child("notification")
                                            .child(appcontext.getInstance().DriverId).setValue(null);
                                }

                            }catch (Exception e){
                                Log.d("notifybookingdata",e.getMessage()+" ,");

                                e.printStackTrace();
                            }
                            //setdatajobdetails(response.toString());
                        }

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();

                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                params.put("BookingId", booking_id );


                params.put("Parms", "BookingId,,"+NotificationJobArrivedBooking_id);
                params.put("Action", "FnJobDetails");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(this).add(postRequest);
    }

    void GetPromoDetailsFromserver(final String notifcationData) {
        StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("promodetails",response.toString());
                        try{
                            pref.put("PromoDetails",response);
                        }catch (Exception e){
                            e.printStackTrace();
                        }
                        try {
                            JSONArray jsonArray = new JSONArray(response);
                            appcontext.getInstance().BasicAmount =  jsonArray.getJSONObject(0).getString("BasicAmount");
                            appcontext.getInstance().MaxDiscount =  jsonArray.getJSONObject(0).getString("MaxDiscount");
                            appcontext.getInstance().Percentage =  jsonArray.getJSONObject(0).getString("Percentage");
                            appcontext.getInstance().promoType =  jsonArray.getJSONObject(0).getString("Type");

                        }catch (Exception e){
                            e.printStackTrace();
                        }

                        jobarivedfromfirebase(notifcationData);

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
//                        pd.dismiss();
//                        Toast.makeText(CompletedJobDetail.this, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                params.put("BookingId", booking_id );

                String param = "PromoId,,"+appcontext.getInstance().PromoId+"";

                Log.e("dataforestimation: ",param);
                params.put("Parms", param);
                params.put("Action", "FnPromoCalcuation");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(this).add(postRequest);


    }

    void MakeAllZonesrequest() {
        Log.d("httpsSSL", "called");
        postRequest = new StringRequest(Request.Method.POST, getApplicationContext().getString(R.string.FnCompanyAllZones),

                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("httpsSSLresponseZone", response.toString());
                        try {
                            pref.put("AllZones", response);
                            Log.e("locationupdateresponse", response);
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //  pd.dismiss();
                        try {
                            Log.d("httpsSSL", error.getMessage());
                            Log.d("httpsSSL1", error.networkResponse.statusCode + "");
                            Log.d("httpsSSL2", error.networkResponse.allHeaders.get(0).getName());
                            Log.d("httpsSSL", error.networkResponse.data.toString());
                        }catch (Exception e){

                        }
                    }
                }
        ) {
//            @Override
//            public Map<String, String> getHeaders() throws AuthFailureError {
//                Map<String,String> params = new HashMap<String, String>();
//                // Removed this line if you dont need it or Use application/json
//                // params.put("Content-Type", "application/x-www-form-urlencoded");
//                return params;
//            }

//            @Override
//            public Map<String, String> getHeaders() throws AuthFailureError {
//                Map<String,String> headers = new HashMap<String, String>();
//                headers.put("Content-Type", "application/json; charset=UTF-8");
//                return headers;
//            }


//            @Override
//            public String getBodyContentType()
//            {
//                return "application/json; charset=utf-8";
//            }

            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
                try {
//                    JSONObject data = new JSONObject();
//                    data.put("BookingId", "220");
//
//                    JSONArray jsonArray = new JSONArray();
//                    jsonArray.put(data);
//                    Log.e("jsonarray",jsonArray.toString().substring(1,jsonArray.toString().length()-1));

//                    Map<String, String> subparam = new HashMap<>();
//                    subparam.put("BookingId", "220");
////
////                    Map<String, String> subsubparam = new HashMap<>();
////                    subparam.put("Params", subparam.toString() );
//                    final SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
                    String param = "CompanyId,," + pref.getString("company_id");

//
//                    params.put("Parms", param);
//                    params.put("Action", "FnCompanyAllZones");
                      params.put("CompanyId",pref.getString("company_id"));
                    params.put("UserKey", appcontext.getInstance().passforlink);
                    params.put("Token", appcontext.getInstance().token);
                    Log.e("httpsparmsare",params.toString());

                }catch (Exception e){
                    e.printStackTrace();
                }

                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
//        Volley.newRequestQueue(getApplicationContext()).add(postRequest);
//            postRequest.setRetryPolicy(new DefaultRetryPolicy(
//                    50000,
//                    DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
//                    DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
            appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(MainActivity.this).add(postRequest);
    }

    DatabaseReference dbRef;


    ServiceConnection serviceconnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName componentName, IBinder iBinder) {
            Taximetterservice.Servicebinderclass Servicebinderclass = (Taximetterservice.Servicebinderclass) iBinder;
            taximetterservice = Servicebinderclass.getservice();

            appcontext.getInstance().timeclock = taximetterservice.gettimer();
            appcontext.getInstance().taximetterservice = taximetterservice;
            try {
                Uri url1 = appcontext.getInstance().mAuthfirebase.getCurrentUser().getPhotoUrl();
                Log.e("url", url1.getPath());

                if(appcontext.getInstance().metterstatus.equalsIgnoreCase("started")){

                }else {

                    dbRef = FirebaseDatabase.getInstance().getReference().child("jobs").child(pref.getString("company_id"))
                            .child(pref.getString("SelectedVehicleid") + "").child(FirebaseAuth.getInstance().getCurrentUser().getUid() + "");

                    dbRef.addListenerForSingleValueEvent(new ValueEventListener() {
                        @Override
                        public void onDataChange(DataSnapshot dataSnapshot) {
                            try {
                                HashMap<String, Object> firebasedata = new HashMap<>();
                                for (DataSnapshot childSnapshot : dataSnapshot.getChildren()) {
                                    firebasedata.put(childSnapshot.getKey(), childSnapshot.getValue());
                                }
                                    appcontext.getInstance().JobArrivedDeviceUid = firebasedata.get("PassengerUid").toString();
//                                if ((!appcontext.getInstance().metterstatus.equalsIgnoreCase("started"))&&firebasedata.getMetterstatus().equalsIgnoreCase("started")&&pref.getString("Shiftstatus").equalsIgnoreCase("started")) {
//                                    pref.put("activebookingid",firebasedata.bookingid);
                                    appcontext.getInstance().metterstatus = "started";
                                    appcontext.getInstance().activebookingid = firebasedata.get("bookingid").toString();

                                    appcontext.getInstance().waitingseconds = Double.parseDouble(firebasedata.get("waitingtime").toString());
                                    appcontext.getInstance().pickup = firebasedata.get("pickup").toString();
                                    appcontext.getInstance().dropoff = firebasedata.get("dropoff").toString();
                                    appcontext.getInstance().Tarrifid = firebasedata.get("TarrifId").toString();


                                    appcontext.getInstance().totalseconds = Double.parseDouble(firebasedata.get("totalseconds").toString());

                                    appcontext.getInstance().timeclock = firebasedata.get("time").toString();
                                    appcontext.getInstance().DistanceCovered = firebasedata.get("distance").toString();
                                    appcontext.getInstance().utilmetterdistance = Double.parseDouble(firebasedata.get("distance").toString());

                                    String[] mydata = firebasedata.get("latlngpath").toString().split("n");

                                    if(mydata.length!=1) {

                                        for (String data: mydata) {

                                            com.google.android.gms.maps.model.LatLng laatnng = new com.google.android.gms.maps.model.LatLng(Double.parseDouble(data.split(",")[0]), Double.parseDouble(data.split(",")[1]));
                                            appcontext.getInstance().pathformetter.add(laatnng);

                                        }
                                    }
                                    if(firebasedata.get("metterstatus").toString().equalsIgnoreCase("dispatched")){
//                                    dbRef.setValue(null);
                                        appcontext.getInstance().mettercalled =1;
                                        startActivity(new Intent(getBaseContext(),CurrentJobDetail.class)
                                                .putExtra("booking_id",firebasedata.get("bookingid").toString()));

                                    }else if (firebasedata.get("metterstatus").toString().equalsIgnoreCase("started")&&pref.getString("Shiftstatus").equalsIgnoreCase("started")) {
                                        appcontext.getInstance().taximetterservice.starttime();
                                        startActivity(new Intent(MainActivity.this, MapsActivityJobLocation.class));
                                }
                            }catch (Exception e){
                                Log.e("dataintrupted",e.getMessage());
                                e.printStackTrace();
                            }

                        }

                        @Override
                        public void onCancelled(DatabaseError databaseError) {

                        }
                    });

                }


            }catch (Exception e) {
                Log.e("url", e.getMessage());
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName componentName) {

        }
    };





}
