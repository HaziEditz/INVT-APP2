package com.khybertech.taxi360driver.JobView;

import android.Manifest;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.AsyncTask;
import android.os.Handler;
import android.preference.PreferenceManager;
import android.support.design.widget.FloatingActionButton;
import android.support.design.widget.TabLayout;
import android.support.v4.app.ActivityCompat;
import android.support.v4.app.Fragment;
import android.support.v4.app.FragmentManager;
import android.support.v4.app.FragmentPagerAdapter;
import android.support.v4.content.ContextCompat;
import android.support.v4.view.ViewPager;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.support.v7.widget.Toolbar;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.WindowManager;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.database.FirebaseDatabase;
import com.khybertech.taxi360driver.Chat.ChatActivity;
import com.khybertech.taxi360driver.JobView.Fragments.Chat;
import com.khybertech.taxi360driver.JobView.Fragments.Current;
import com.khybertech.taxi360driver.JobView.Fragments.Offers;
import com.khybertech.taxi360driver.JobView.Fragments.Queue;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.MainActivity.Taximetterservice;
import com.khybertech.taxi360driver.R;
//import com.onesignal.OSNotification;
//import com.onesignal.OSNotificationOpenResult;
//import com.onesignal.OneSignal;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class JobView extends AppCompatActivity  {

    ViewPager viewpager_jobview;

    TabLayout tablayout_jobview;
    ViewPagerAdapter adapter;
    FloatingActionButton backbtn ;
    ListView listview;
    String selected = "dispatch";
    Intent intent;
    Toolbar toolbar_jobview;
    String companyId;
    int driverId;
    Current current;
    Offers offers;
    Queue queue;
    SecurePreferences pref;
    SecurePreferences edit;
    Location loc_tobesent_via_notification;
    String loc_string;
    LocationManager lMngr;
    LocationListener locationListener;
    Geocoder gc;
    int permissionCheckCoarseLoc = 0;
    String url_alert = "";//"http://webservices.360taxitaxi.co.nz/api/DriverApp/DriverAlertsUsers";

    StringRequest   postRequest;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        setContentView(R.layout.activity_job_view);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

//        OneSignal.startInit(this).inFocusDisplaying(OneSignal.OSInFocusDisplayOption.Notification).setNotificationOpenedHandler(this).init();
//        OneSignal.startInit(this).inFocusDisplaying(OneSignal.OSInFocusDisplayOption.InAppAlert).setNotificationReceivedHandler(this).init();
        widgets();

        backbtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                finish();
            }
        });

        backbtn.setOnLongClickListener(new View.OnLongClickListener() {

            @Override
            public boolean onLongClick(View v) {

                Calendar c = Calendar.getInstance();
                SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy HH:mm:ss", Locale.ENGLISH);
                String currentDateTime = format.format(c.getTime());

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

        appcontext.getInstance().con = JobView.this;
//        pref = PreferenceManager.getDefaultSharedPreferences(JobView.this);
//        edit = pref.edit();
          pref = appcontext.getInstance().pref;

        viewpager_jobview.addOnPageChangeListener(new ViewPager.OnPageChangeListener() {

            @Override
            public void onPageScrolled(int position, float positionOffset, int positionOffsetPixels) {



            }

            @Override
            public void onPageSelected(int position) {
                Log.e("pageselected:",position+"");
                if(position==0){
                    try{
                        postRequest.cancel();
                    }catch (Exception e){
                        e.printStackTrace();
                    }
//                 if(pref.getString("currentstatus").equalsIgnoreCase("13")){
                 //    Toast.makeText(JobView.this, pref.getString("currentdata",null), Toast.LENGTH_SHORT).show();
                    if(true){
                     Log.e("currentreq","currentrequesting");

                        selected = "current";
                        String url_current = appcontext.getInstance().link;
                        String param = "DriverId,,"+appcontext.getInstance().DriverId;

                        Makepostrequest(param, url_current,"FnDriverCurrentJobs");
                    }

                }
                if (position==1){
                    /*new Handler().postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            if(appcontext.getInstance().busyclicked==1){
                                Taximtterobj.performaclickonstart();
                                appcontext.getInstance().busyclicked=0;



                            }
                        }
                    },100);

*/
                }
                if(position==1){
                    try{
                        postRequest.cancel();
                    }catch (Exception e){
                        e.printStackTrace();
                    }
//                    if(pref.getString("queuestatus").equalsIgnoreCase("13")){
                   //     Toast.makeText(JobView.this, pref.getString("queuedata",null), Toast.LENGTH_SHORT).show();
                    if(true) {
                        selected = "queue";
                        String url_queue = appcontext.getInstance().link;
                        String param = "DriverId,,"+appcontext.getInstance().DriverId;
                        Makepostrequest(param, url_queue,"FnDriverQueueJobs");
                    }
                }
                if(position==2){
                    try{
                        postRequest.cancel();
                    }catch (Exception e){
                        e.printStackTrace();
                    }
//                    if(pref.getString("offersstatus").equalsIgnoreCase("13")){
                     //   Toast.makeText(JobView.this, pref.getString("offersdata",null), Toast.LENGTH_SHORT).show();
                    if(true) {
                        selected = "offers";
                        String url_offers = appcontext.getInstance().link;
                        String param = "DriverId,,"+appcontext.getInstance().DriverId;

                        Makepostrequest(param, url_offers,"FnDriverOfferedJobs");
                    }

                }
                if(position==42){
                    try{
                        postRequest.cancel();
                    }catch (Exception e){
                        e.printStackTrace();
                    }

                    String dataa = pref.getString("completedstatus");
                    if(dataa==null){
                        dataa = "";
                    }

                    if(dataa.equalsIgnoreCase("1")){
                       // Toast.makeText(JobView.this, pref.getString("completeddata",null), Toast.LENGTH_SHORT).show();
                    }else {
                        selected = "completed";
                        String url = appcontext.getInstance().link;
                        String param = "DriverId,,"+appcontext.getInstance().DriverId;
                        Makepostrequest(param, url,"FnDriverClosedJobs");
                    }
                 }
                if(position==3){
                    try{
                        postRequest.cancel();
                    }catch (Exception e){
                        e.printStackTrace();
                    }
//                    if(pref.getString("chatstatus").equalsIgnoreCase("300")){
                      //  Toast.makeText(JobView.this, pref.getString("chatdata",null), Toast.LENGTH_SHORT).show();
                    if(true) {
                        selected = "chat";
                        String url_chat = appcontext.getInstance().link;
                        String param = "";
                        param = "DriverId,,"+appcontext.getInstance().DriverId+"" +
                                "&&CompanyId,,"+ pref.getString("company_id");

                        Makepostrequest(param, url_chat,"DriverInbox");
                    }

                }


            }

            @Override
            public void onPageScrollStateChanged(int state) {

            }
        });

        url_alert = appcontext.getInstance().link;//"http://webservices.360taxitaxi.co.nz/api/DriverApp/DriverAlertsUsers";

try {
    driverId = Integer.parseInt(appcontext.getInstance().DriverId);
}catch (Exception e){
    e.printStackTrace();
}
        lMngr = (LocationManager) getSystemService(LOCATION_SERVICE);

        new Thread(new Runnable() {
            @Override
            public void run () {



                        gc = new Geocoder(JobView.this);

            }
        }).start();




        /*if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED &&
                ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "No Location Permission Granted", Toast.LENGTH_SHORT).show();
            return;
        }*/
        int permissionCheckFineLoc = ContextCompat.checkSelfPermission(this,
                Manifest.permission.ACCESS_FINE_LOCATION);
        permissionCheckCoarseLoc = ContextCompat.checkSelfPermission(this,
                Manifest.permission.ACCESS_COARSE_LOCATION);
        Log.e("permission",""+permissionCheckCoarseLoc);
        if (permissionCheckCoarseLoc == -1){
            ActivityCompat.requestPermissions(JobView.this,new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},01);
        }else {

            locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(final Location location) {
                loc_tobesent_via_notification = location;
                new Thread(new Runnable() {
                    @Override
                    public void run () {

                        try {
                            List<Address> ls = gc.getFromLocation(location.getLatitude(),location.getLongitude(),1);
                            loc_string = ls.get(0).getAddressLine(0);
                        } catch (IOException e) {
                            e.printStackTrace();
                        }

                    }
                }).start();



            }

            @Override
            public void onStatusChanged(String s, int i, Bundle bundle) {

            }

            @Override
            public void onProviderEnabled(String s) {
                Toast.makeText(JobView.this, "GPS Powered Off", Toast.LENGTH_SHORT).show();
            }

            @Override
            public void onProviderDisabled(String s) {

            }
        };
            //Permission Granted
            lMngr.requestLocationUpdates(lMngr.NETWORK_PROVIDER, 0, 0, locationListener);

        }
        companyId = pref.getString("company_id");
        setUpViewPager();
        tablayout_jobview.setupWithViewPager(viewpager_jobview);
        setUpTabIcons();
        setSupportActionBar(toolbar_jobview);
        intent = getIntent();
        try {
            int isNotification = intent.getExtras().getInt("fromNotification", 0);
         //   if (isNotification == 1) {

        //    }
       // else {
        //    viewpager_jobview.setCurrentItem(5);
            viewpager_jobview.setCurrentItem(1);
       // }
    }catch(Exception e){

        }
        viewpager_jobview.setOffscreenPageLimit(4);

        viewpager_jobview.setCurrentItem(1);
        viewpager_jobview.setCurrentItem(0);



    }
public ViewPager viewPag(){
    return viewpager_jobview;
}
    //pos1
    void Makepostrequest(final String paramrecieved, final String url, final String method){
           Log.e("req:","reqqq");
        postRequest = new StringRequest(Request.Method.POST, url,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d(selected + "jobviewdataresp", response.toString());
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")) {


                        }else {

                        if (selected.equalsIgnoreCase("current")) {
                            appcontext.getInstance().currentdata = new HashMap<>();
                            appcontext.getInstance().currentdata.put(selected, response.toString());
                            SecurePreferences editor = pref;
                            editor.put("currentstatus", "1");
                            editor.put("currentdata", response);

                            Log.e("currentresponse", response);
                            current.setdata(response.toString());


                        } else if (selected.equalsIgnoreCase("queue")) {
                            appcontext.getInstance().queuedata = new HashMap<>();
                            appcontext.getInstance().queuedata.put(selected, response.toString());
                            SecurePreferences editor = pref;
                            editor.put("queuestatus", "1");
                            editor.put("queuedata", response);
                            queue.setdata(response);

                        } else if (selected.equalsIgnoreCase("offers")) {
                            appcontext.getInstance().offereddata = new HashMap<>();
                            appcontext.getInstance().offereddata.put(selected, response.toString());
                            SecurePreferences editor = pref;
                            editor.put("offersstatus", "1");
                            editor.put("offersdata", response);
                            offers.setdata(response);
                        } else if (selected.equalsIgnoreCase("completed")) {
                            appcontext.getInstance().completeddata = new HashMap<>();
                            appcontext.getInstance().completeddata.put(selected, response.toString());
                            SecurePreferences editor = pref;
                            editor.put("completedstatus", "1");
                            editor.put("completeddata", response);

                        } else if (selected.equalsIgnoreCase("chat")) {
                            appcontext.getInstance().chatdata = new HashMap<>();
                            appcontext.getInstance().chatdata.put(selected, response.toString());
                            SecurePreferences editor = pref;
                            editor.put("chatstatus", "1");
                            editor.put("chatdata", response);
                        }

                    }

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        Log.e("error in data","error");
                        appcontext.getInstance().Networkdata =   new HashMap<>();
                        appcontext.getInstance().Networkdata.put(selected,"network error");
                        //   pd.dismiss();
                        Toast.makeText(JobView.this, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();

                params.put("Parms", paramrecieved);
                params.put("Action", method);
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
//        Volley.newRequestQueue(JobView.this).add(postRequest);

    }


    @Override
    protected void onDestroy() {
        super.onDestroy();
        lMngr.removeUpdates(locationListener);
    }

    Taximetterservice taximetterservice;


    @Override
    protected void onStart() {
        super.onStart();
        taximetterservice = appcontext.getInstance().taximetterservice;
        //service bound
      /*  try {
            Intent taximetterserviceintent = new Intent(JobView.this, Taximetterservice.class);
            bindService(taximetterserviceintent, serviceconnection, Context.BIND_AUTO_CREATE);
        }catch (Exception e){
            Log.e("msg",e.getMessage());

        }
*/
    }
    /*
    ServiceConnection serviceconnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName componentName, IBinder iBinder) {
            Taximetterservice.Servicebinderclass Servicebinderclass = (Taximetterservice.Servicebinderclass) iBinder;
            taximetterservice = Servicebinderclass.getservice();
            appcontext.getInstance().timeclock = taximetterservice.gettimer();
            appcontext.getInstance().taximetterservice = taximetterservice;
            }

        @Override
        public void onServiceDisconnected(ComponentName componentName) {

        }
    };
*/



    private void setUpTabIcons(){
        TextView tab_one = (TextView) LayoutInflater.from(this).inflate(R.layout.custom_tab,null).findViewById(R.id.tab);
        tab_one.setText("Current");
        tab_one.setCompoundDrawablesWithIntrinsicBounds(0,R.drawable.current_icon,0,0);
        tablayout_jobview.getTabAt(0).setCustomView(tab_one);
/*
        TextView tab_2 = (TextView) LayoutInflater.from(this).inflate(R.layout.custom_tab,null).findViewById(R.id.tab);
        tab_2.setText("Taximetter");
        tab_2.setCompoundDrawablesWithIntrinsicBounds(0,R.drawable.dispatch_icon,0,0);
        tablayout_jobview.getTabAt(1).setCustomView(tab_2);

*/
        TextView tab_two = (TextView) LayoutInflater.from(this).inflate(R.layout.custom_tab,null).findViewById(R.id.tab);
        tab_two.setText("Assigned");
        tab_two.setCompoundDrawablesWithIntrinsicBounds(0,R.drawable.queue_icon,0,0);
        tablayout_jobview.getTabAt(1).setCustomView(tab_two);

        TextView tab_three = (TextView) LayoutInflater.from(this).inflate(R.layout.custom_tab,null).findViewById(R.id.tab);
        tab_three.setText("Offers");
        tab_three.setCompoundDrawablesWithIntrinsicBounds(0,R.drawable.offers_icon,0,0);
        tablayout_jobview.getTabAt(2).setCustomView(tab_three);
/*
        TextView tab_four = (TextView) LayoutInflater.from(this).inflate(R.layout.custom_tab,null).findViewById(R.id.tab);
        tab_four.setText("Completed");
        tab_four.setCompoundDrawablesWithIntrinsicBounds(0,R.drawable.completed_icon,0,0);
        tablayout_jobview.getTabAt(4).setCustomView(tab_four);

        TextView tab_five = (TextView) LayoutInflater.from(this).inflate(R.layout.custom_tab,null).findViewById(R.id.tab);
        tab_five.setText("Dispatch");
        tab_five.setCompoundDrawablesWithIntrinsicBounds(0,R.drawable.dispatch_icon,0,0);
        tablayout_jobview.getTabAt(5).setCustomView(tab_five);
*/
// chat tabe hidden for now
//        TextView tab_six = (TextView) LayoutInflater.from(this).inflate(R.layout.custom_tab,null).findViewById(R.id.tab);
//        tab_six.setText("Chat");
//        tab_six.setCompoundDrawablesWithIntrinsicBounds(0,R.drawable.chat_icon,0,0);
//        tablayout_jobview.getTabAt(3).setCustomView(tab_six);
    }
    Current currentobj = appcontext.getInstance().currentobj;


    private void setUpViewPager() {
        adapter = new ViewPagerAdapter(getSupportFragmentManager());
        current = currentobj;
        adapter.addFrag(currentobj,"Current");
      //  adapter.addFrag(Taximtterobj,"Taximetter");
        queue = new Queue();
        adapter.addFrag(queue,"Queue");
        offers = new Offers();
        adapter.addFrag(offers,"Offers");
      //  adapter.addFrag(new Completed(),"Completed");
     //   adapter.addFrag(new Dispatch(),"Dispatch");
//        adapter.addFrag(new Chat(),"Chat");
        viewpager_jobview.setAdapter(adapter);
    }

    private void widgets() {
        viewpager_jobview = (ViewPager) findViewById(R.id.viewpager_jobview);
        tablayout_jobview = (TabLayout) findViewById(R.id.tablayout_jobview);
        toolbar_jobview = (Toolbar) findViewById(R.id.toolbar_jobview);
        backbtn = (FloatingActionButton) findViewById(R.id.btn_backbtn);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        MenuInflater m = getMenuInflater();
        m.inflate(R.menu.menu_job_view,menu);
        return super.onCreateOptionsMenu(menu);
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        switch (id){
            case R.id.alert:
                if (permissionCheckCoarseLoc == -1){
                    ActivityCompat.requestPermissions(JobView.this,new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},01);
                }else if (loc_tobesent_via_notification == null){
                    Toast.makeText(this, "There is some issue with your GPS, please retry", Toast.LENGTH_SHORT).show();
                }
                else {
                    new sendAlert().execute();
                }
                break;
        }
        return super.onOptionsItemSelected(item);
    }
//
//    @Override
//    public void notificationOpened(OSNotificationOpenResult result) {
//        final String id_sender,username,id_job = null;
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
//                Toast.makeText(this, "message", Toast.LENGTH_SHORT).show();
//                new Handler().postDelayed(new Runnable() {
//                    @Override
//                    public void run() {
//                        startActivity(new Intent(JobView.this,ChatActivity.class).putExtra("id", id_sender).putExtra("name", username));
//                    }
//                },500);
//            }
//            else if (body.equalsIgnoreCase(ifJob)){
//                Toast.makeText(this, "job", Toast.LENGTH_SHORT).show();
//                new Handler().postDelayed(new Runnable() {
//                    @Override
//                    public void run() {
//                        startActivity(new Intent(JobView.this,JobView.class).putExtra("fromNotification",1));
//                    }
//                },500);
//            }
//            Log.e("hey",body);
//        }
//        catch (Exception ex){
//
//        }
//        /*String id = null;
//        String username = null;
//        JSONObject title = result.toJSONObject();
//        JSONObject data = result.notification.payload.additionalData;
//        Log.e("hey",""+title);
//        try {
//            id = data.getString("SenderId");
//            username = data.getString("username");
//        }
//        catch (Exception ex){
//            Log.e("hey",ex.getMessage());
//        }
//        final String finalId = id;
//        final String finalUsername = username;
//        new Handler().postDelayed(new Runnable() {
//            @Override
//            public void run() {
//                startActivity(new Intent(MainActivity.this,ChatActivity.class).putExtra("id", finalId).putExtra("name", finalUsername));
//            }
//        },500);*/
//    }
//
//    @Override
//    public void notificationReceived(OSNotification notification) {
//       // Toast.makeText(getApplicationContext(), "notifcation recieved jobview", Toast.LENGTH_SHORT).show();
//    }
//

    class ViewPagerAdapter extends FragmentPagerAdapter{

        private final List<Fragment> mFragmentList = new ArrayList<>();
        private final List<String> mFragmentTitleList = new ArrayList<>();

        public ViewPagerAdapter(FragmentManager fm) {
            super(fm);
        }

        @Override
        public Fragment getItem(int position) {
            return mFragmentList.get(position);
        }

        @Override
        public int getCount() {
            return mFragmentList.size();
        }

        public void addFrag(Fragment fragment, String title) {
            mFragmentList.add(fragment);
            mFragmentTitleList.add(title);
            if(title.equalsIgnoreCase("Completed")){
              //  listview = (ListView) fragment.getView().findViewById(R.id.lv_fragment_completed);
            }
            Log.e("title:",title);

        }

        @Override
        public CharSequence getPageTitle(int position) {
            return mFragmentTitleList.get(position);
        }
    }

    public class sendAlert extends AsyncTask<String,Void,String> {
        ProgressDialog pd;
        String data = "";

        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(JobView.this,"CabsWiki","Sending Alert",false,false);
        }

        @Override
        protected String doInBackground(String... strings) {
            try {
                URL url = new URL(url_alert);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                String params = "CompanyId="+companyId+"&DriverId="+driverId+"&Location="+loc_string;
                Log.e("params",params);
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(params);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
                writer.close();
                reader.close();
            }
            catch (Exception ex){

            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            try {
                JSONArray arr = new JSONArray(s);
                for (int i = 0; i < arr.length(); i++){
                    JSONObject obj = arr.getJSONObject(i);
                    String playerId = obj.getString("PlayerId");
                    Log.e("amad",playerId);

                    JSONObject obj_tobesent = new JSONObject();
                    JSONObject contents = new JSONObject();
                    JSONArray include_player_ids = new JSONArray();
                    JSONObject data = new JSONObject();
                    contents.put("en","I have an emergency at "+loc_string);
                    data.put("driverId",driverId);
                    include_player_ids.put(0,playerId);
                    obj_tobesent.put("contents",contents);
                    obj_tobesent.put("data",data);
                    obj_tobesent.put("include_player_ids",include_player_ids);
                    Log.e("maddy",obj_tobesent.toString());
//                    OneSignal.postNotification(obj_tobesent, new OneSignal.PostNotificationResponseHandler() {
//                        @Override
//                        public void onSuccess(JSONObject response) {
//                            Log.e("maddy",response.toString());
//                        }
//
//                        @Override
//                        public void onFailure(JSONObject response) {
//                            Log.e("maddy","Failure"+response.toString());
//                        }
//                    });
                }
            }
            catch (Exception ex){

            }
            finally {
                pd.dismiss();
            }
            Log.e("amad",s);
        }
    }




}
