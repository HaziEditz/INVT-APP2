package com.khybertech.taxi360driver.JobView;

import android.Manifest;
import android.app.ProgressDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.AsyncTask;
import android.preference.PreferenceManager;
import android.support.v4.app.ActivityCompat;
import android.support.v4.content.ContextCompat;
import android.support.v7.app.AlertDialog;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.support.v7.widget.Toolbar;
import android.telephony.SmsManager;
import android.util.Log;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.MainActivity.BaseActivity;
import com.khybertech.taxi360driver.MainActivity.FixedPrice;
import com.khybertech.taxi360driver.Maps.MapsActivityJobLocation;
import com.khybertech.taxi360driver.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

public class QueueJobDetail extends BaseActivity {

    SecurePreferences pref;
    String booking_id, playerId = "", message,linkservice = "", statusparams = "",method;
    Toolbar toolbar_queue_job_detail;
    String JobdetailString = "";
    String DropLatLng="";
    String PickLatLng="empty";
    ProgressDialog pd;
    TextView txt_queuejob_booking_id, txt_bookingdetails_booking_info, txt_offeredjob_cornerjob,txt_queuejob_passenger_name,txt_queuejob_passenger_id,
            txt_queuejob_company_discount,txt_queuejob_driver_discount,txt_queuejob_payment_type,txt_queuejob_booking_date,
            txt_queuejob_booking_time,txt_queuejob_pick_addr,txt_queuejob_pick_latlong,txt_queuejob_drop_addr,
            txt_queuejob_drop_latlong,txt_queuejob_estimated_time,txt_queuejob_estimated_distance,txt_queuejob_passengers,
            txt_queuejob_bags,txt_queuejob_wheelchairs,txt_queuejob_booking_status;
    Button btn_active_queuejobdetail,btn_cancel_queuejobdetail,btn_notavailable_queuejobdetail;
    SmsManager sms_manager;
    int permissionCheckSms;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_queue_job_detail);
        widgts();
        appcontext.getInstance().queudetailsactivity = this;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
//        pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
        pref = appcontext.getInstance().pref;
        booking_id = getIntent().getExtras().getString("booking_id","null");
        MakePostRequestjobdetails();
        appcontext.getInstance().backgroundstatus = "Picking";
        txt_queuejob_pick_addr.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                    navigatetogooglemaps();
            }
        });
        //new getJobDetails().execute();
        sms_manager = SmsManager.getDefault();
        setSupportActionBar(toolbar_queue_job_detail);
        btn_active_queuejobdetail.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                AlertDialog.Builder alert = new AlertDialog.Builder(QueueJobDetail.this);
                alert.setTitle("360taxi");
                alert.setMessage("Are you sure?");
                alert.setPositiveButton("Yes", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialogInterface, int i) {
                        if(btn_active_queuejobdetail.getText().toString().equalsIgnoreCase("ACTIVE")) {
//                            try {
//                                pref.getString("prevjobid");
//                            } catch (Exception e) {
//                                e.printStackTrace();
//                            }
                            try {
                                statusparams = "BookingId,," + booking_id + "" +
                                        "&&Status,," + "Active" + "&&DriverId,," + appcontext.getInstance().DriverId + "" +
                                        "&&Vehicleid,," + pref.getString("SelectedVehicleid");
                                linkservice = appcontext.getInstance().link;
                                method = "FnActiveJobsStatus";

                                MakePostcompleteJob();
                            }catch (Exception e){
                                e.printStackTrace();
                            }
                        }else {
                            btn_active_queuejobdetail.setText("ACTIVE");
                            btn_active_queuejobdetail.setBackgroundColor(Color.RED);
                            if(!appcontext.getInstance().JobArrivedDeviceType.equalsIgnoreCase("Dispatcher")){
                                HashMap<String, Object> data = new HashMap<>();
                                data.put("status", "arrived");
                                data.put("bookingid", booking_id);
                                data.put("VehicleId", pref.getString("SelectedVehicleid"));
                                data.put("DriverId", appcontext.getInstance().DriverId);

                                FirebaseDatabase.getInstance().getReference()
                                        .child("Passengerjobs")
                                        .child(appcontext.getInstance().JobArrivedDeviceUid)
                                        .setValue(data);
                            }


//                            appcontext.getInstance().paramsforsms = new HashMap<>();
//                            appcontext.getInstance().number = txt_queuejob_passenger_id.getText().toString();
//                            appcontext.getInstance().paramsforsms.put("Code",appcontext.getInstance().smscode);
//
//                            appcontext.getInstance().MakesmsRequest(appcontext.getInstance().con.getString(R.string.FnDriverArrivedText));
//
//                            Log.e("val",message);
//                    String msg = "Dear User your ride has arrived. thank you.";
//                    sms_manager.sendTextMessage(txt_queuejob_passenger_id.getText().toString(),null,msg,null,null);
                          //  Toast.makeText(this, "Message was sent to "+txt_queuejob_passenger_id.getText().toString(), Toast.LENGTH_SHORT).show();
                            Log.e("msg:","sent");
                        }
                    }
                });
                alert.setNegativeButton("Cancel", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialogInterface, int i) {

                    }
                });
                alert.show();


            }
        });
        btn_cancel_queuejobdetail.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                statusparams = "BookingId,,"+booking_id+"" +
                        "&&Status,,"+"Cancel"+"" +
                        "&&DriverId,,"+appcontext.getInstance().DriverId+"" +
                        "&&Vehicleid,,"+pref.getString("SelectedVehicleid")+"&&ZoneId,,"+appcontext.getInstance().currentzone;
                linkservice = appcontext.getInstance().link;
                method = "FnCancelJobsStatus";
                appcontext.getInstance().backgroundstatus = "Available";
                appcontext.getInstance().ChangestatusRequest();
                MakePostcompleteJob();
                HashMap<String, Object> data = new HashMap<>();
                data.put("status", "cancel");
                data.put("bookingid", booking_id);
                data.put("VehicleId", pref.getString("SelectedVehicleid"));
                data.put("DriverId", appcontext.getInstance().DriverId);
                FirebaseDatabase.getInstance().getReference()
                        .child("Passengerjobs")
                        .child(appcontext.getInstance().JobArrivedDeviceUid)
                        .setValue(data);

//                new completeJob().execute("Cancel");
                Log.e("canelcalled",linkservice);

            }
        });
        btn_notavailable_queuejobdetail.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                statusparams = "BookingId,,"+booking_id+"" +
                        "&&Status,,"+"No Show"+"" +
                        "&&DriverId,,"+appcontext.getInstance().DriverId+"" +
                        "&&Vehicleid,,"+pref.getString("SelectedVehicleid")+"&&ZoneId,,"
                        +appcontext.getInstance().currentzone;
                linkservice = appcontext.getInstance().link;
                method = "FnCancelJobsStatus";
                appcontext.getInstance().backgroundstatus = "Available";
                appcontext.getInstance().ChangestatusRequest();
                HashMap<String, Object> data = new HashMap<>();
                data.put("status", "cancel");
                data.put("bookingid", booking_id);
                data.put("VehicleId", pref.getString("SelectedVehicleid"));
                data.put("DriverId", appcontext.getInstance().DriverId);
                FirebaseDatabase.getInstance().getReference()
                        .child("Passengerjobs")
                        .child(appcontext.getInstance().JobArrivedDeviceUid)
                        .setValue(data);
                MakePostcompleteJob();
//                new completeJob().execute("No Show");

            }
        });
        txt_queuejob_passenger_id.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {

                String phno="tel:"+txt_queuejob_passenger_id.getText().toString();

                Intent i=new Intent(Intent.ACTION_DIAL, Uri.parse(phno));
                startActivity(i);
            }
        });
        LinearLayout pickuplinear = (LinearLayout)findViewById(R.id.pickupclicker);
        pickuplinear.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
//                Intent m = new Intent(QueueJobDetail.this, MapsActivityJobLocation.class);
//                m.putExtra("whocalledme",1);
//                m.putExtra("pick_latlong",txt_queuejob_pick_latlong.getText().toString());
//                m.putExtra("drop_latlong",txt_queuejob_drop_latlong.getText().toString());
//                startActivity(m);
                Toast.makeText(QueueJobDetail.this, "Featured Disabled wait for updates", Toast.LENGTH_SHORT).show();
            }
        });
        txt_queuejob_drop_addr.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
//                Intent m = new Intent(QueueJobDetail.this, MapsActivityJobLocation.class);
//                m.putExtra("whocalledme",1);
//                m.putExtra("pick_latlong",txt_queuejob_pick_latlong.getText().toString());
//                m.putExtra("drop_latlong",txt_queuejob_drop_latlong.getText().toString());
//                startActivity(m);
                Toast.makeText(QueueJobDetail.this, "Featured Disabled wait for updates", Toast.LENGTH_SHORT).show();

            }
        });
    }




void navigatetogooglemaps(){
if(PickLatLng.equalsIgnoreCase("empty")){
    Toast.makeText(this, "pickup Zone Not Defined", Toast.LENGTH_SHORT).show();
}else {
    Uri gmmIntentUri = Uri.parse("google.navigation:q="+PickLatLng+"&mode=d");
    Intent mapIntent = new Intent(Intent.ACTION_VIEW, gmmIntentUri);
    mapIntent.setPackage("com.google.android.apps.maps");
    startActivity(mapIntent);
}
}
    private void widgts() {

        txt_bookingdetails_booking_info = (TextView) findViewById(R.id.txt_bookingdetails_booking_info);
        txt_offeredjob_cornerjob = (TextView) findViewById(R.id.txt_offeredjob_cornerjob);

        txt_queuejob_booking_id = (TextView) findViewById(R.id.txt_queuejob_booking_id);
        txt_queuejob_passenger_name = (TextView) findViewById(R.id.txt_queuejob_passenger_name);
        txt_queuejob_passenger_id = (TextView) findViewById(R.id.txt_queuejob_passenger_id);
        txt_queuejob_company_discount = (TextView) findViewById(R.id.txt_queuejob_company_discount);
        txt_queuejob_driver_discount = (TextView) findViewById(R.id.txt_queuejob_driver_discount);
        txt_queuejob_payment_type = (TextView) findViewById(R.id.txt_queuejob_payment_type);
        txt_queuejob_booking_date = (TextView) findViewById(R.id.txt_queuejob_booking_date);
        txt_queuejob_booking_time = (TextView) findViewById(R.id.txt_queuejob_booking_time);
        txt_queuejob_pick_addr = (TextView) findViewById(R.id.txt_queuejob_pick_addr);
        txt_queuejob_pick_latlong = (TextView) findViewById(R.id.txt_queuejob_pick_latlong);
        txt_queuejob_drop_addr = (TextView) findViewById(R.id.txt_queuejob_drop_addr);
        txt_queuejob_drop_latlong = (TextView) findViewById(R.id.txt_queuejob_drop_latlong);
        txt_queuejob_estimated_time = (TextView) findViewById(R.id.txt_queuejob_estimated_time);
        txt_queuejob_estimated_distance = (TextView) findViewById(R.id.txt_queuejob_estimated_distance);
        txt_queuejob_passengers = (TextView) findViewById(R.id.txt_queuejob_passengers);
        txt_queuejob_bags = (TextView) findViewById(R.id.txt_queuejob_bags);
        txt_queuejob_wheelchairs = (TextView) findViewById(R.id.txt_queuejob_wheelchairs);
        txt_queuejob_booking_status = (TextView) findViewById(R.id.txt_queuejob_booking_status);
        btn_active_queuejobdetail = (Button) findViewById(R.id.btn_active_queuejobdetail);
        btn_cancel_queuejobdetail = (Button) findViewById(R.id.btn_cancel_queuejobdetail);
        btn_notavailable_queuejobdetail = (Button) findViewById(R.id.btn_notavailable_queuejobdetail);
        toolbar_queue_job_detail = (Toolbar) findViewById(R.id.toolbar_queue_job_detail);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        MenuInflater m = getMenuInflater();
        //m.inflate(R.menu.menu_quejob,menu);

        return super.onCreateOptionsMenu(menu);
    }

    @Override
    protected void onStart() {
        super.onStart();
        try {
            appcontext.getInstance().Offerdetailsactivity.finish();
        }catch (Exception e){
            e.printStackTrace();
        }
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        switch (id){
            case R.id.waiting:
                permissionCheckSms = 1;//ContextCompat.checkSelfPermission(QueueJobDetail.this,
                        //Manifest.permission.SEND_SMS);
                Log.e("val",""+permissionCheckSms);
                if (permissionCheckSms == -1){
                    ActivityCompat.requestPermissions(QueueJobDetail.this, new String[]{Manifest.permission.SEND_SMS},72);
                }
                else {
                    if(!appcontext.getInstance().JobArrivedDeviceType.equalsIgnoreCase("Dispatcher")){
                    HashMap<String, Object> data = new HashMap<>();
                    data.put("status", "arrived");
                    data.put("bookingid", booking_id);
                    data.put("VehicleId", pref.getString("SelectedVehicleid"));
                    data.put("DriverId", appcontext.getInstance().DriverId);

                    FirebaseDatabase.getInstance().getReference()
                            .child("Passengerjobs")
                            .child(appcontext.getInstance().JobArrivedDeviceUid)
                            .setValue(data);
                }


                    appcontext.getInstance().paramsforsms = new HashMap<>();
                    appcontext.getInstance().number = txt_queuejob_passenger_id.getText().toString();
                    appcontext.getInstance().paramsforsms.put("Code",appcontext.getInstance().smscode);

                    appcontext.getInstance().MakesmsRequest(appcontext.getInstance().con.getString(R.string.FnDriverArrivedText));
                   // Log.e("val",message);
//                    String msg = "Dear User your ride has arrived. thank you.";
//                    sms_manager.sendTextMessage(txt_queuejob_passenger_id.getText().toString(),null,msg,null,null);
                    Toast.makeText(this, "Message was sent to "+txt_queuejob_passenger_id.getText().toString(), Toast.LENGTH_SHORT).show();
                    Log.e("msg:","sent");
                }
                break;
        }
        return super.onOptionsItemSelected(item);
    }



// in doubt to why was this called but is removed test it later
    public class getPlayerId extends AsyncTask<String,Void,String>{
        String data="";

        @Override
        protected void onPreExecute() {

        }

        @Override
        protected String doInBackground(String... strings) {
            try {
                URL url = new URL( appcontext.getInstance().link );//"http://webservices.360taxitaxi.co.nz/api/DriverApp/PassengerPlayerID");
                String params = "BookingId="+booking_id;
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
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
                Log.e("Taxi360taxi",ex.getMessage());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
           // pd.dismiss();
            Log.e("val",s);
            try{
                JSONObject obj = new JSONObject(s);
                JSONArray arr1 = obj.getJSONArray("PassengerPlayerId");
                JSONArray arr2 = obj.getJSONArray("DriverMessage");
                playerId = arr1.getJSONObject(0).getString("PhoneNo");
                message = arr2.getJSONObject(0).getString("Message");
            }
            catch (Exception ex){

            }
            Log.e("que",s);
        }
    }
    LinearLayout loading;
    void MakePostRequestjobdetails() {

        loading = (LinearLayout) findViewById(R.id.loadingbarqueue);
        loading.setVisibility(View.VISIBLE);
        StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link ,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("dataresp",response.toString());
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")){
                            MakePostRequestjobdetails();
                        }else {
                            setdatajobdetails(response.toString());
                        }

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        Toast.makeText(QueueJobDetail.this, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                params.put("BookingId", booking_id );


                params.put("Parms", "BookingId,,"+booking_id);
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

    void setdatajobdetails(String s){
        loading.setVisibility(View.GONE);
            try {

//                JSONObject obj = new JSONObject(s);
                JSONArray arr = new JSONArray(s);
                String booking_id_fromjson = arr.getJSONObject(0).getString("BookingId");
                String Name = arr.getJSONObject(0).getString("Name");
                String PassengerId = arr.getJSONObject(0).getString("PassengerId");
                String CompanyDiscount = arr.getJSONObject(0).getString("CompanyDiscount");
                String DriverDiscount = arr.getJSONObject(0).getString("DriverDiscount");
                String PaymentType = arr.getJSONObject(0).getString("PaymentType");
                String BookingDate = arr.getJSONObject(0).getString("BookingDate");
                String BookingTime = arr.getJSONObject(0).getString("BookingTime");
                String PickAddress = arr.getJSONObject(0).getString("PickAddress");

                PickLatLng = arr.getJSONObject(0).getString("PickLatLng");
                String DropAddress = arr.getJSONObject(0).getString("DropAddress");

                appcontext.getInstance().pickup = PickAddress;
                appcontext.getInstance().dropoff = DropAddress;

                DropLatLng = arr.getJSONObject(0).getString("DropLatLng");
                String EstimatedTime = arr.getJSONObject(0).getString("EstimatedTime");
                String EstimatedDistance = arr.getJSONObject(0).getString("EstimatedDistance");
                String Passengers = arr.getJSONObject(0).getString("Passengers");
                String Bags = arr.getJSONObject(0).getString("Bags");
                String WheelChairs = arr.getJSONObject(0).getString("WheelChairs");
                String BookingStatus = arr.getJSONObject(0).getString("BookingStatus");
                appcontext.getInstance().pocket = Float.parseFloat(arr.getJSONObject(0).getString("Pocket"));


                String CornerAddress = arr.getJSONObject(0).getString("CornerAddress");
                String bookinginfo = arr.getJSONObject(0).getString("EntitiesDetails");



                txt_offeredjob_cornerjob.setText(CornerAddress);
                txt_bookingdetails_booking_info.setText(bookinginfo);

                txt_queuejob_booking_id.setText(booking_id_fromjson);
                txt_queuejob_passenger_name.setText(Name);
                txt_queuejob_passenger_id.setText(PassengerId);
                txt_queuejob_company_discount.setText(CompanyDiscount);
                txt_queuejob_driver_discount.setText(DriverDiscount);
                txt_queuejob_payment_type.setText(PaymentType);
                txt_queuejob_booking_date.setText(BookingDate);
                txt_queuejob_booking_time.setText(BookingTime);
                txt_queuejob_pick_addr.setText(PickAddress);
                txt_queuejob_pick_latlong.setText(PickLatLng);
                txt_queuejob_drop_addr.setText(DropAddress);
                txt_queuejob_drop_latlong.setText(DropLatLng);
                txt_queuejob_estimated_time.setText(EstimatedTime);
                txt_queuejob_estimated_distance.setText(EstimatedDistance);
                txt_queuejob_passengers.setText(Passengers);
                txt_queuejob_bags.setText(Bags);
                txt_queuejob_wheelchairs.setText(WheelChairs);
                txt_queuejob_booking_status.setText(BookingStatus);

                JobdetailString = s;
//                new getPlayerId().execute();
            }
            catch (Exception ex){
                Log.e("error",ex.getMessage());
            }

    }

//    class getJobDetails extends AsyncTask<Void,Void,String> {
//        String data = "";
//        @Override
//        protected void onPreExecute() {
//            pd = ProgressDialog.show(QueueJobDetail.this,"CabsWiki","Downloading",false,false);
//        }
//
//        @Override
//        protected String doInBackground(Void... voids) {
//            try {
//                URL url = new URL(getApplicationContext().getString(R.string.FnJobDetails));//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnJobDetails");
//                String params = "BookingId="+booking_id;
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
//            try {
////                JSONObject obj = new JSONObject(s);
//                JSONArray arr = new JSONArray(s);
//                String booking_id_fromjson = arr.getJSONObject(0).getString("BookingId");
//                String Name = arr.getJSONObject(0).getString("Name");
//                String PassengerId = arr.getJSONObject(0).getString("PassengerId");
//                String CompanyDiscount = arr.getJSONObject(0).getString("CompanyDiscount");
//                String DriverDiscount = arr.getJSONObject(0).getString("DriverDiscount");
//                String PaymentType = arr.getJSONObject(0).getString("PaymentType");
//                String BookingDate = arr.getJSONObject(0).getString("BookingDate");
//                String BookingTime = arr.getJSONObject(0).getString("BookingTime");
//                String PickAddress = arr.getJSONObject(0).getString("PickAddress");
//
//                PickLatLng = arr.getJSONObject(0).getString("PickLatLng");
//                String DropAddress = arr.getJSONObject(0).getString("DropAddress");
//                String DropLatLng = arr.getJSONObject(0).getString("DropLatLng");
//                String EstimatedTime = arr.getJSONObject(0).getString("EstimatedTime");
//                String EstimatedDistance = arr.getJSONObject(0).getString("EstimatedDistance");
//                String Passengers = arr.getJSONObject(0).getString("Passengers");
//                String Bags = arr.getJSONObject(0).getString("Bags");
//                String WheelChairs = arr.getJSONObject(0).getString("WheelChairs");
//                String BookingStatus = arr.getJSONObject(0).getString("BookingStatus");
//                txt_queuejob_booking_id.setText(booking_id_fromjson);
//                txt_queuejob_passenger_name.setText(Name);
//                txt_queuejob_passenger_id.setText(PassengerId);
//                txt_queuejob_company_discount.setText(CompanyDiscount);
//                txt_queuejob_driver_discount.setText(DriverDiscount);
//                txt_queuejob_payment_type.setText(PaymentType);
//                txt_queuejob_booking_date.setText(BookingDate);
//                txt_queuejob_booking_time.setText(BookingTime);
//                txt_queuejob_pick_addr.setText(PickAddress);
//                txt_queuejob_pick_latlong.setText(PickLatLng);
//                txt_queuejob_drop_addr.setText(DropAddress);
//                txt_queuejob_drop_latlong.setText(DropLatLng);
//                txt_queuejob_estimated_time.setText(EstimatedTime);
//                txt_queuejob_estimated_distance.setText(EstimatedDistance);
//                txt_queuejob_passengers.setText(Passengers);
//                txt_queuejob_bags.setText(Bags);
//                txt_queuejob_wheelchairs.setText(WheelChairs);
//                txt_queuejob_booking_status.setText(BookingStatus);
//
//
////                new getPlayerId().execute();
//            }
//            catch (Exception ex){
//                Log.e("error",ex.getMessage());
//            }
//        }
//    }

    void MakePostcompleteJob() {
           showProgressDialog();
        loading = (LinearLayout) findViewById(R.id.loadingbarqueue);
        loading.setVisibility(View.VISIBLE);
        StringRequest postRequest = new StringRequest(Request.Method.POST, linkservice ,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("dataresp",response.toString());
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")){
                            MakePostcompleteJob();
                        }else {
                            postExecute(response.toString());
                        }

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        hideProgressDialog();
                        Toast.makeText(QueueJobDetail.this, "Please make sure you are connected to internet!", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                params.put("BookingId", booking_id );


                params.put("Parms", statusparams);
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
//        Volley.newRequestQueue(this).add(postRequest);
    }

    void postExecute(String s) {
        hideProgressDialog();
        try {
            JSONArray jsonArray = new JSONArray(s);
          String result = jsonArray.getJSONObject(0).getString("Result");

          if(result.equalsIgnoreCase("ride successfully started")){
              appcontext.getInstance().backgroundstatus = "Busy";
              appcontext.getInstance().ChangestatusRequest();
              HashMap<String, Object> data1 = new HashMap<>();
              data1.put("status", "active");
              data1.put("bookingid", booking_id);
              data1.put("VehicleId", pref.getString("SelectedVehicleid"));
              data1.put("DriverId", appcontext.getInstance().DriverId);
              FirebaseDatabase.getInstance().getReference()
                      .child("Passengerjobs")
                      .child(appcontext.getInstance().JobArrivedDeviceUid)
                      .setValue(data1);
//                new completeJob().execute("Active");
              //   startActivity(new Intent(QueueJobDetail.this,CurrentJobDetail.class).putExtra("booking_id",booking_id));
//                pref.put("activebookingid",booking_id);

                  appcontext.getInstance().metterstatus = "started";
                  appcontext.getInstance().activebookingid = booking_id;
                  appcontext.getInstance().taximetterservice.starttime();
                  startActivity(new Intent(QueueJobDetail.this, MapsActivityJobLocation.class));
                  //finish();
                  DatabaseReference dbRef = FirebaseDatabase.getInstance().getReference().child("online");
                  HashMap<String, Object> data = new HashMap<>();
                  data.put("lat", appcontext.getInstance().realtimelocation.getLatitude() + "");
                  data.put("lng", appcontext.getInstance().realtimelocation.getLatitude() + "");
                  data.put("drivername", pref.getString("name"));
                  data.put("vehiclestatus", appcontext.getInstance().backgroundstatus);

                  data.put("speed", "");
                  data.put("vehiclenumber", pref.getString("SelectedVehicleName"));

//            data.put("VehicleId",pref.getString("SelectedVehicleid"));
                  data.put("time", "");


                  dbRef.child(pref.getString("company_id"))
                          .child(pref.getString("SelectedVehicleid") + "")
                          .child(FirebaseAuth.getInstance().getCurrentUser().getUid() + "").setValue(data);

                  Log.e("Status", s);
                  QueueJobDetail.this.finish();


          }else{
              appcontext.getInstance().backgroundstatus = "Available";
              appcontext.getInstance().ChangestatusRequest();
              Toast.makeText(this, result, Toast.LENGTH_SHORT).show();
              finish();

          }
               }catch (Exception e){
            e.printStackTrace();
        }
    }

    public class completeJob extends AsyncTask<String,Void,String>{
        String data="";
        ProgressDialog pd;

        @Override
        protected void onPreExecute() {
            if(linkservice.equalsIgnoreCase(appcontext.getInstance().link))
             pd = ProgressDialog.show(QueueJobDetail.this,"Cabs Wiki","Submitting!",false,false);
        }

        @Override
        protected String doInBackground(String... strings) {
            try {
                URL url = new URL(linkservice);//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnJobsStatus");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(statusparams);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
                writer.close();
                reader.close();
            }
            catch (Exception ex){
                Log.e("Taxi360taxi",ex.getMessage());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            if(linkservice.equalsIgnoreCase(appcontext.getInstance().link))
             pd.dismiss();
            Log.e("Status",s);
            QueueJobDetail.this.finish();
        }
    }


}
