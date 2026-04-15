package com.khybertech.taxi360driver.JobView;

import android.app.ProgressDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.AsyncTask;
import android.os.Vibrator;
import android.preference.PreferenceManager;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.util.Log;
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
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.FirebaseDatabase;
import com.khybertech.taxi360driver.Chat.ChatActivity;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.MainActivity.BaseActivity;
import com.khybertech.taxi360driver.R;
//import com.onesignal.OneSignal;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.Timer;
import java.util.TimerTask;

public class OfferedJobDetail extends AppCompatActivity {

    String booking_id,servicelink,statuschanged = "no status";
    SecurePreferences pref;
    String assignment,method;
    String playerId="";

   Timer T = new Timer();
    int seconds, hours, minutes,countdown = 24;
    String currentDateTime = "";
    int countminutes = 1;
    int countTime = 0;

    TextView txt_bookingdetails_booking_info,txt_offeredjob_cornerjob,txt_offeredjob_booking_id,txt_offeredjob_passenger_name,txt_offeredjob_passenger_id,
            txt_offeredjob_company_discount,txt_offeredjob_driver_discount,txt_offeredjob_payment_type,txt_offeredjob_booking_date,
            txt_offeredjob_booking_time,txt_offeredjob_pick_addr,txt_offeredjob_pick_latlong,txt_offeredjob_drop_addr,
            txt_offeredjob_drop_latlong,txt_offeredjob_estimated_time,txt_offeredjob_estimated_distance,txt_offeredjob_passengers,
            txt_offeredjob_bags,txt_offeredjob_wheelchairs,txt_offeredjob_booking_status,txt_offeredjob_timer;
    Button btn_accept_offeredjobdetail,btn_reject_offeredjobdetail;
    Ringtone r;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);

        setContentView(R.layout.activity_offered_job_detail);

        appcontext.getInstance().isnotificationwindowsOpeneed = true;
        Vibrator v = (Vibrator) this.getSystemService(Context.VIBRATOR_SERVICE);
//        pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
        pref = appcontext.getInstance().pref;
        // Vibrate for 500 milliseconds
        v.vibrate(5000);
        Uri notification = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        r = RingtoneManager.getRingtone(getApplicationContext(), notification);
        r.play();
        widgts();
        booking_id = getIntent().getExtras().getString("booking_id","null");
        appcontext.getInstance().Offerdetailsactivity = this;
        try{
          String getstatus =  getIntent().getExtras().getString("statuschanged","null");
          statuschanged = getstatus;
        }catch (Exception e){
            Log.e("status",e.getMessage());
            statuschanged = "no status";
            e.printStackTrace();
        }
        if (statuschanged.equalsIgnoreCase("offered")){
            method = "FnJobsStatus";
            servicelink = appcontext.getInstance().link;//getApplicationContext().getString(R.string.FnJobsStatus);
        }else {
            method = "FnPendingJobsStatus";
            servicelink =appcontext.getInstance().link;// getApplicationContext().getString(R.string.FnPendingJobsStatus);
        }
        MakePostRequestjobdetails();
      //  new getJobDetails().execute();xl
        btn_accept_offeredjobdetail.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                FirebaseDatabase.getInstance().getReference()
                        .child("notification")
                        .child(appcontext.getInstance().DriverId).setValue(null);
                try {
                    r.stop();
                    T.cancel();
                }catch (Exception e){

                }

                assignment ="Assigned";
                try {
                    pref.put("prevjobid", booking_id);
                }catch (Exception e){
                    e.printStackTrace();
                }
                MakePostRequestcompletejob();
//                new completeJob().execute("Assigned");


            }
        });
        btn_reject_offeredjobdetail.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                FirebaseDatabase.getInstance().getReference()
                        .child("notification")
                        .child(appcontext.getInstance().DriverId).setValue(null);
                try {
                    r.stop();
                    T.cancel();
                }catch (Exception e){

                }
                if(statuschanged.equalsIgnoreCase("offered")) {
                    assignment ="Reject";
                    MakePostRequestcompletejob();
//                    new completeJob().execute("Reject");
                }else {

                    finish();
                }
            }
        });
    }

    private void widgts() {
        txt_offeredjob_booking_id = (TextView) findViewById(R.id.txt_offeredjob_booking_id);
        txt_offeredjob_passenger_name = (TextView) findViewById(R.id.txt_offeredjob_passenger_name);
        txt_offeredjob_passenger_id = (TextView) findViewById(R.id.txt_offeredjob_passenger_id);
        txt_offeredjob_company_discount = (TextView) findViewById(R.id.txt_offeredjob_company_discount);
        txt_offeredjob_driver_discount = (TextView) findViewById(R.id.txt_offeredjob_driver_discount);
        txt_offeredjob_payment_type = (TextView) findViewById(R.id.txt_offeredjob_payment_type);
        txt_offeredjob_booking_date = (TextView) findViewById(R.id.txt_offeredjob_booking_date);
        txt_offeredjob_booking_time = (TextView) findViewById(R.id.txt_offeredjob_booking_time);
        txt_offeredjob_pick_addr = (TextView) findViewById(R.id.txt_offeredjob_pick_addr);
        txt_offeredjob_pick_latlong = (TextView) findViewById(R.id.txt_offeredjob_pick_latlong);
        txt_offeredjob_drop_addr = (TextView) findViewById(R.id.txt_offeredjob_drop_addr);
        txt_offeredjob_drop_latlong = (TextView) findViewById(R.id.txt_offeredjob_drop_latlong);
        txt_offeredjob_estimated_time = (TextView) findViewById(R.id.txt_offeredjob_estimated_time);
        txt_offeredjob_estimated_distance = (TextView) findViewById(R.id.txt_offeredjob_estimated_distance);
        txt_offeredjob_passengers = (TextView) findViewById(R.id.txt_offeredjob_passengers);
        txt_offeredjob_bags = (TextView) findViewById(R.id.txt_offeredjob_bags);
        txt_offeredjob_wheelchairs = (TextView) findViewById(R.id.txt_offeredjob_wheelchairs);
        txt_offeredjob_booking_status = (TextView) findViewById(R.id.txt_offeredjob_booking_status);
        txt_offeredjob_timer = (TextView) findViewById(R.id.txt_offeredjob_bartimer);
        txt_offeredjob_cornerjob = (TextView) findViewById(R.id.txt_offeredjob_cornerjob);
        txt_bookingdetails_booking_info = (TextView) findViewById(R.id.txt_bookingdetails_booking_info);

        btn_reject_offeredjobdetail = (Button) findViewById(R.id.btn_reject_offeredjobdetail);
        btn_accept_offeredjobdetail = (Button) findViewById(R.id.btn_accept_offeredjobdetail);
    }

    LinearLayout loading;

    public ProgressDialog mProgressDialog;

    public void showProgressDialog() {
        if (mProgressDialog == null) {
            mProgressDialog = new ProgressDialog(this);
            mProgressDialog.setMessage("Loading…");
            mProgressDialog.setIndeterminate(true);
        }

        mProgressDialog.show();
    }

    public void hideProgressDialog() {
        if (mProgressDialog != null && mProgressDialog.isShowing()) {
            mProgressDialog.dismiss();
        }
    }

    @Override
    public void onBackPressed() {
//        super.onBackPressed();
        Toast.makeText(this, "You need to accept or reject this job!", Toast.LENGTH_SHORT).show();
//        r.stop();
//        finish();
    }

    @Override
    protected void onStart() {
        super.onStart();
        appcontext.getInstance().isnotificationwindowsOpeneed =true;
    }

    @Override
    protected void onStop() {
        super.onStop();

        try {
            r.stop();
        }catch (Exception e){
            e.printStackTrace();
        }
        try {
            T.cancel();
            T.purge();
        }catch (Exception e){
            e.printStackTrace();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        appcontext.getInstance().isnotificationwindowsOpeneed = false;
    }

    void MakePostRequestjobdetails() {

        loading = (LinearLayout) findViewById(R.id.loadingbaroffer);
        loading.setVisibility(View.VISIBLE);
      StringRequest  postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link ,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("dataresp",response.toString());
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")){
                            MakePostRequestjobdetails();
                        }else {
try {
    T.scheduleAtFixedRate(new TimerTask() {
        @Override
        public void run() {

            hours = countdown / 3600;
            minutes = (countdown % 3600) / 60;
            seconds = countdown % 60;
            countTime++;
            try {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {

                            txt_offeredjob_timer.setText(String.format("%02d:%02d", minutes, seconds));

                            if (seconds == 0) {
                                try {
                                    r.stop();

                                } catch (Exception e) {

                                }try {

                                    T.cancel();
                                } catch (Exception e) {

                                }
                                assignment = "Reject";
                                MakePostRequestcompletejob();
//                                                    new completeJob().execute("Reject");

                            }
                        }catch (Exception e){
                            e.printStackTrace();
                        }
                    }
                });
//
            } catch (Exception e) {
                e.printStackTrace();
                Log.e("error in txt", e.getMessage());
            }


            Log.e("timer", countTime + " " + seconds);

            seconds++;
            countdown--;

        }
    }, 1000, 1000);
}catch (Exception e){
    e.printStackTrace();
}
                            setdatajobdetails(response.toString());
                        }

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        Toast.makeText(OfferedJobDetail.this, "network error", Toast.LENGTH_SHORT).show();
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
             try {
//                 JSONObject obj = new JSONObject(s);
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
                 String PickLatLng = arr.getJSONObject(0).getString("PickLatLng");
                 String DropAddress = arr.getJSONObject(0).getString("DropAddress");
                 String DropLatLng = arr.getJSONObject(0).getString("DropLatLng");
                 String EstimatedTime = arr.getJSONObject(0).getString("EstimatedTime");
                 String EstimatedDistance = arr.getJSONObject(0).getString("EstimatedDistance");
                 String Passengers = arr.getJSONObject(0).getString("Passengers");
                 String Bags = arr.getJSONObject(0).getString("Bags");
                 String WheelChairs = arr.getJSONObject(0).getString("WheelChairs");

                 String BookingStatus = arr.getJSONObject(0).getString("BookingStatus");
                 String CornerAddress = arr.getJSONObject(0).getString("CornerAddress");
                 String bookinginfo = arr.getJSONObject(0).getString("EntitiesDetails");


                 playerId = arr.getJSONObject(0).getString("PlayerId");
                 appcontext.getInstance().pocket = Float.parseFloat(arr.getJSONObject(0).getString("Pocket"));
                 txt_offeredjob_booking_id.setText(booking_id_fromjson);
                 txt_offeredjob_cornerjob.setText(CornerAddress);
                 txt_bookingdetails_booking_info.setText(bookinginfo);
                 txt_offeredjob_passenger_name.setText(Name);
                 txt_offeredjob_passenger_id.setText(PassengerId);
                 txt_offeredjob_company_discount.setText(CompanyDiscount);
                 txt_offeredjob_driver_discount.setText(DriverDiscount);
                 txt_offeredjob_payment_type.setText(PaymentType);
                 txt_offeredjob_booking_date.setText(BookingDate);
                 txt_offeredjob_booking_time.setText(BookingTime);
                 txt_offeredjob_pick_addr.setText(PickAddress);
                 txt_offeredjob_pick_latlong.setText(PickLatLng);
                 txt_offeredjob_drop_addr.setText(DropAddress);
                 txt_offeredjob_drop_latlong.setText(DropLatLng);
                 txt_offeredjob_estimated_time.setText(EstimatedTime);
                 txt_offeredjob_estimated_distance.setText(EstimatedDistance);
                 txt_offeredjob_passengers.setText(Passengers);
                 txt_offeredjob_bags.setText(Bags);
                 txt_offeredjob_wheelchairs.setText(WheelChairs);
                 txt_offeredjob_booking_status.setText(BookingStatus);
             }
             catch (Exception ex){
                 Log.e("error",ex.getMessage());
             }
             loading.setVisibility(View.GONE);

     }

    class getJobDetails extends AsyncTask<Void,Void,String> {
        ProgressDialog pd;
        String data = "";
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(OfferedJobDetail.this,"CabsWikki","Downloading",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL( appcontext.getInstance().link);//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnJobDetails");
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
            try {
                JSONObject obj = new JSONObject(s);
                JSONArray arr = obj.getJSONArray("DriverJobsInfo");
                String booking_id_fromjson = arr.getJSONObject(0).getString("BookingId");
                String Name = arr.getJSONObject(0).getString("Name");
                String PassengerId = arr.getJSONObject(0).getString("PassengerId");
                String CompanyDiscount = arr.getJSONObject(0).getString("CompanyDiscount");
                String DriverDiscount = arr.getJSONObject(0).getString("DriverDiscount");
                String PaymentType = arr.getJSONObject(0).getString("PaymentType");
                String BookingDate = arr.getJSONObject(0).getString("BookingDate");
                String BookingTime = arr.getJSONObject(0).getString("BookingTime");
                String PickAddress = arr.getJSONObject(0).getString("PickAddress");
                String PickLatLng = arr.getJSONObject(0).getString("PickLatLng");
                String DropAddress = arr.getJSONObject(0).getString("DropAddress");
                String DropLatLng = arr.getJSONObject(0).getString("DropLatLng");
                String EstimatedTime = arr.getJSONObject(0).getString("EstimatedTime");
                String EstimatedDistance = arr.getJSONObject(0).getString("EstimatedDistance");
                String Passengers = arr.getJSONObject(0).getString("Passengers");
                String Bags = arr.getJSONObject(0).getString("Bags");
                String WheelChairs = arr.getJSONObject(0).getString("WheelChairs");
                String BookingStatus = arr.getJSONObject(0).getString("BookingStatus");



                txt_offeredjob_booking_id.setText(booking_id_fromjson);
                txt_offeredjob_passenger_name.setText(Name);
                txt_offeredjob_passenger_id.setText(PassengerId);
                txt_offeredjob_company_discount.setText(CompanyDiscount);
                txt_offeredjob_driver_discount.setText(DriverDiscount);
                txt_offeredjob_payment_type.setText(PaymentType);
                txt_offeredjob_booking_date.setText(BookingDate);
                txt_offeredjob_booking_time.setText(BookingTime);
                txt_offeredjob_pick_addr.setText(PickAddress);
                txt_offeredjob_pick_latlong.setText(PickLatLng);
                txt_offeredjob_drop_addr.setText(DropAddress);
                txt_offeredjob_drop_latlong.setText(DropLatLng);
                txt_offeredjob_estimated_time.setText(EstimatedTime);
                txt_offeredjob_estimated_distance.setText(EstimatedDistance);
                txt_offeredjob_passengers.setText(Passengers);
                txt_offeredjob_bags.setText(Bags);
                txt_offeredjob_wheelchairs.setText(WheelChairs);
                txt_offeredjob_booking_status.setText(BookingStatus);
            }
            catch (Exception ex){
                Log.e("error",ex.getMessage());
            }
            pd.dismiss();
        }
    }

    int countr = 0;
    void MakePostRequestcompletejob() {
//        loading.setVisibility(View.VISIBLE);
        try{
        showProgressDialog();
        if (countr > 4) {
            countr = 0;
            hideProgressDialog();
            Toast.makeText(this, "Network problem!\nAre you connected to network?", Toast.LENGTH_SHORT).show();
            return;
        }

        StringRequest postRequest = new StringRequest(Request.Method.POST, servicelink,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("dataresp", response.toString());
                        // pd.dismiss();
                        if (response.equalsIgnoreCase("error")) {
                            MakePostRequestcompletejob();
                        } else {
                            hideProgressDialog();
                            postExecute(response.toString());
                        }

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        countr++;
                        MakePostRequestcompletejob();
                        Toast.makeText(OfferedJobDetail.this, "Network Error Retry!", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                params.put("BookingId", booking_id );

                String param = "BookingId,," + booking_id + "&&Status,,"
                        + assignment + "&&DriverId,," + appcontext.getInstance().DriverId
                        + "&&VehicleId,," + pref.getString("SelectedVehicleid") + "&&ZoneId,,"
                        + appcontext.getInstance().currentzone;
                Log.e("acceptparam", param);

                params.put("Parms", param);
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
    }catch (Exception e){
            e.printStackTrace();
        }
    }
    void postExecute(String s) {
         try {
             JSONArray jsonArray = new JSONArray(s);
             s = jsonArray.getJSONObject(0).getString("Result");
         }catch (Exception e){
             e.printStackTrace();
         }
        if(s.equalsIgnoreCase("Ride Status successfully Updated to Assigned")){
            appcontext.getInstance().currentjob();
            appcontext.getInstance().backgroundstatus="Picking";
            appcontext.getInstance().ChangestatusRequest();
            if(!appcontext.getInstance().JobArrivedDeviceType.equalsIgnoreCase("Dispatcher")){
                HashMap<String, Object> data = new HashMap<>();
                    data.put("status", "accepted");
                    data.put("bookingid", booking_id);
                    data.put("VehicleId", pref.getString("SelectedVehicleid"));
                    data.put("DriverId", appcontext.getInstance().DriverId);
                    data.put("PhoneNo", pref.getString("PhoneNo"));
                    data.put("url", FirebaseAuth.getInstance().getCurrentUser().getPhotoUrl().getPath());

           FirebaseDatabase.getInstance()
                        .getReference()
                        .child("Passengerjobs")
                        .child(appcontext.getInstance().JobArrivedDeviceUid)
                        .setValue(data);
            }
            sendmessagedata(s);
            startActivity(new Intent(OfferedJobDetail.this,QueueJobDetail.class).putExtra("booking_id",booking_id));
            OfferedJobDetail.this.finish();
        } else if(s.equalsIgnoreCase("Ride Status successfully Updated to Reject")){

            Toast.makeText(OfferedJobDetail.this, "Rejected", Toast.LENGTH_SHORT).show();
            finish();
        }
        else if (s.equalsIgnoreCase("Ride status not successfully updated,please try again")){
            Toast.makeText(OfferedJobDetail.this, "Something went wrong, Try again", Toast.LENGTH_SHORT).show();
        }else if(s.equalsIgnoreCase("Job already assigned")){
            FirebaseDatabase.getInstance().getReference()
                    .child("notification")
                    .child(appcontext.getInstance().DriverId).setValue(null);
            Toast.makeText(OfferedJobDetail.this, "Already Assigned thank you", Toast.LENGTH_SHORT).show();
            OfferedJobDetail.this.finish();
        }else {
            Log.e("jobstatus",s);
            Toast.makeText(OfferedJobDetail.this, "Something Went wrong please try again later", Toast.LENGTH_SHORT).show();
        }

    }

    void sendmessagedata(String s) {
//        Toast.makeText(ChatActivity.this, s, Toast.LENGTH_SHORT).show();
//        etxt_sendmessage_chat.setText("");
        try {
            Log.e("player_id",appcontext.getInstance().playerID);
            JSONObject obj = new JSONObject();
            JSONObject contents = new JSONObject();
            JSONArray include_player_ids = new JSONArray();
            JSONObject data = new JSONObject();
            contents.put("en","job accepted");
            data.put("VehicleId",pref.getString("SelectedVehicleid"));
            data.put("DriverId",appcontext.getInstance().DriverId);
            include_player_ids.put(0,appcontext.getInstance().playerID);
            obj.put("contents",contents);
            obj.put("data",data);
            obj.put("include_player_ids",include_player_ids);
            Log.e("maddy",obj.toString());

            //Log.e("player_id",date_tobe_sent);
//            OneSignal.postNotification(obj, new OneSignal.PostNotificationResponseHandler() {
//                @Override
//                public void onSuccess(JSONObject response) {
//                    Log.e("msgsucess",response.toString());
//                }
//
//                @Override
//                public void onFailure(JSONObject response) {
//                    Log.e("msgNotfail",response.toString());
//                }
//            });

        } catch (JSONException e) {
            Log.e("player_id",e.getMessage());
        }
        Log.e("resp",s);
    }

//    public class completeJob extends AsyncTask<String,Void,String>{
//        String data="";
//        ProgressDialog pd;
//
//        @Override
//        protected void onPreExecute() {
//            try {
//                pd = ProgressDialog.show(OfferedJobDetail.this, "Cabs Wiki", "Submitting!", false, false);
//            }catch (Exception e){
//                e.printStackTrace();
//            }
//        }
//
//        @Override
//        protected String doInBackground(String... strings) {
//            try {
//
//                URL url = new URL(servicelink);//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnJobsStatus");
//                String params = "BookingId="+booking_id+"&Status="+strings[0]+"&DriverId="+pref.getString("user_id");
//                Log.e("jobstatusin",strings[0]);
//               // Toast.makeText(OfferedJobDetail.this, strings[0], Toast.LENGTH_SHORT).show();
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
//                Log.e("Taxi360taxi jobstatus",ex.getMessage());
//            }
//            return data;
//        }
//
//        @Override
//        protected void onPostExecute(String s) {
//            super.onPostExecute(s);
//            pd.dismiss();
//            if(s.equalsIgnoreCase("Job Status successfully updated to Assigned")){
//            startActivity(new Intent(OfferedJobDetail.this,QueueJobDetail.class).putExtra("booking_id",booking_id));
//               finish();
//            } else if(s.equalsIgnoreCase("Job Status successfully updated to Reject")){
//                Toast.makeText(OfferedJobDetail.this, "Rejected", Toast.LENGTH_SHORT).show();
//                finish();
//                }
//            else if (s.equalsIgnoreCase("Job status not successfully updated to Assigned,please try again")){
//                Toast.makeText(OfferedJobDetail.this, "Something went wrong, Try again", Toast.LENGTH_SHORT).show();
//            }else if(s.equalsIgnoreCase("Job already assigned")){
//                Toast.makeText(OfferedJobDetail.this, "Already Assigned thank you", Toast.LENGTH_SHORT).show();
//                OfferedJobDetail.this.finish();
//            }else {
//                Log.e("jobstatus",s);
//                Toast.makeText(OfferedJobDetail.this, "Something Went wrong please try again later", Toast.LENGTH_SHORT).show();
//            }
//
//        }
//    }
}
