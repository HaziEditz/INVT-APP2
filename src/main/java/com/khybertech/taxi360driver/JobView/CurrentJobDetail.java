package com.khybertech.taxi360driver.JobView;

import android.app.DatePickerDialog;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.AsyncTask;
import android.preference.PreferenceManager;
import android.support.v7.app.AlertDialog;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.support.v7.widget.Toolbar;
import android.util.Log;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.DatePicker;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.NumberPicker;
import android.widget.RadioButton;
import android.widget.RadioGroup;
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
import com.khybertech.taxi360driver.JobView.UpdateJob.UpdateJob;
import com.khybertech.taxi360driver.Maps.MapsActivityJobLocation;
import com.khybertech.taxi360driver.R;
//import com.onesignal.OneSignal;
import com.stripe.android.Stripe;
import com.stripe.android.TokenCallback;
import com.stripe.android.model.Card;
import com.stripe.android.model.SourceParams;
import com.stripe.android.model.Token;
import com.stripe.android.view.CardInputWidget;

import org.joda.time.DateTime;
import org.joda.time.DateTimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;

public class CurrentJobDetail extends AppCompatActivity {
    AlertDialog alert;
    ProgressDialog pd;
    String booking_id,paidamount,RideType;
    String companyId,DriverCost,CompanyComission,BasicAmount="0",MaxDiscount="0",promoType="",Percentage="0";
    String currencycode="usd";
    TextView txt_currentjob_booking_id,txt_currentjob_passenger_name,txt_currentjob_passenger_id,
            txt_currentjob_company_discount,txt_currentjob_driver_discount,txt_currentjob_payment_type,txt_currentjob_booking_date,
            txt_currentjob_booking_time,txt_currentjob_pick_addr,txt_currentjob_pick_latlong,txt_currentjob_drop_addr,
            txt_currentjob_drop_latlong,txt_currentjob_estimated_time,txt_currentjob_estimated_distance,txt_currentjob_passengers,
            txt_currentjob_bags,txt_currentjob_wheelchairs,txt_currentjob_booking_status,txt_currentjob_booking_info,txt_currentjob_booking_type;
    Toolbar toolbar_current_job_detail;
    Button btn_trackjob_currentjob,btn_gotometter;
    int driverId;
    String passengerId,pickLatLng,dropLatLng,pickAddress,dropAddress,passengers,bags,wheelchairs
            ,bookingStatus,dateTime,estimatedDistance,estimatedTime,bookingId,info,bookingType, Ridecost,payment,payment_type,details,currency;
    SecurePreferences pref;
    Calendar c;
    SimpleDateFormat format;
    String currentDate = "";
    String currentTime = "";
    String totalCost = "";
    String Waitingcost = "";
    double completeDistance = 0;
    String completeTime = "";
    private boolean TotalMobilityStatus = false;
    private String TotalMobilityDiscount= "0";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_current_job_detail);
        widgts();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
//        pref = PreferenceManager.getDefaultSharedPreferences(CurrentJobDetail.this);
        pref = appcontext.getInstance().pref;
        try {
            driverId = Integer.parseInt(appcontext.getInstance().DriverId);
            companyId = pref.getString("company_id");
        }catch (Exception e){
            e.printStackTrace();
        }
        setSupportActionBar(toolbar_current_job_detail);
        booking_id = getIntent().getExtras().getString("booking_id","null");


       // new getJobDetails().execute();
        Ridecost = "0";
        payment = "0";
        payment_type = "Credit Card";
        details = "AccNo:12731232312 Bank:MCB";
        currency = "$";

            MakePostRequestjobdetails();


        btn_trackjob_currentjob.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                try {
                    Intent i = new Intent(CurrentJobDetail.this, MapsActivityJobLocation.class);
                    startActivityForResult(i, 177);
                    finish();
                }catch (Exception e){
                    e.printStackTrace();
                }
            }
        });
        btn_gotometter.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                try {
                    Intent i = new Intent(CurrentJobDetail.this, MapsActivityJobLocation.class);
                    startActivityForResult(i, 200);
                    finish();
                }catch (Exception e){
                    e.printStackTrace();
                }
            }
        });



    }




    private void widgts() {
        txt_currentjob_booking_id = (TextView) findViewById(R.id.txt_currentjob_booking_id);
        txt_currentjob_passenger_name = (TextView) findViewById(R.id.txt_currentjob_passenger_name);
        txt_currentjob_passenger_id = (TextView) findViewById(R.id.txt_currentjob_passenger_id);
        txt_currentjob_company_discount = (TextView) findViewById(R.id.txt_currentjob_company_discount);
        txt_currentjob_driver_discount = (TextView) findViewById(R.id.txt_currentjob_driver_discount);
        txt_currentjob_payment_type = (TextView) findViewById(R.id.txt_currentjob_payment_type);
        txt_currentjob_booking_date = (TextView) findViewById(R.id.txt_currentjob_booking_date);
        txt_currentjob_booking_time = (TextView) findViewById(R.id.txt_currentjob_booking_time);
        txt_currentjob_pick_addr = (TextView) findViewById(R.id.txt_currentjob_pick_addr);
        txt_currentjob_pick_latlong = (TextView) findViewById(R.id.txt_currentjob_pick_latlong);
        txt_currentjob_drop_addr = (TextView) findViewById(R.id.txt_currentjob_drop_addr);
        txt_currentjob_drop_latlong = (TextView) findViewById(R.id.txt_currentjob_drop_latlong);
        txt_currentjob_estimated_time = (TextView) findViewById(R.id.txt_currentjob_estimated_time);
        txt_currentjob_estimated_distance = (TextView) findViewById(R.id.txt_currentjob_estimated_distance);
        txt_currentjob_passengers = (TextView) findViewById(R.id.txt_currentjob_passengers);
        txt_currentjob_bags = (TextView) findViewById(R.id.txt_currentjob_bags);
        txt_currentjob_wheelchairs = (TextView) findViewById(R.id.txt_currentjob_wheelchairs);
        txt_currentjob_booking_status = (TextView) findViewById(R.id.txt_currentjob_booking_status);
        toolbar_current_job_detail = (Toolbar) findViewById(R.id.toolbar_current_job_detail);
        txt_currentjob_booking_type = (TextView) findViewById(R.id.txt_currentjob_booking_type);
        txt_currentjob_booking_info = (TextView) findViewById(R.id.txt_currentjob_booking_info);
        btn_trackjob_currentjob = (Button) findViewById(R.id.btn_complete_currentjob);
        btn_gotometter = (Button) findViewById(R.id.btn_gotometer);
    }

    LinearLayout loading;
    void MakePostRequestjobdetails() {

        loading = (LinearLayout) findViewById(R.id.loadingbarcurrent);
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
                            if(appcontext.getInstance().mettercalled == 1) {
                                completejob();
                            }

                        }

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();

                        if(appcontext.getInstance().mettercalled == 1) {
                            completejob();
                        }

                        Toast.makeText(CurrentJobDetail.this, "network error", Toast.LENGTH_SHORT).show();
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
                String PickLatLng = arr.getJSONObject(0).getString("PickLatLng");
                String DropAddress = arr.getJSONObject(0).getString("DropAddress");
                String DropLatLng = arr.getJSONObject(0).getString("DropLatLng");
                String EstimatedTime = arr.getJSONObject(0).getString("EstimatedTime");
                String EstimatedDistance = arr.getJSONObject(0).getString("EstimatedDistance");
                String Passengers = arr.getJSONObject(0).getString("Passengers");
                String Bags = arr.getJSONObject(0).getString("Bags");
                String WheelChairs = arr.getJSONObject(0).getString("WheelChairs");
                String BookingStatus = arr.getJSONObject(0).getString("BookingStatus");
                String BookingType = arr.getJSONObject(0).getString("BookingType");
                String Info = arr.getJSONObject(0).getString("EntitiesDetails");
                appcontext.getInstance().PromoId = arr.getJSONObject(0).getString("PromoCodeId");
                txt_currentjob_booking_id.setText(booking_id_fromjson);
                txt_currentjob_passenger_name.setText(Name);
                txt_currentjob_passenger_id.setText(PassengerId);
                txt_currentjob_company_discount.setText(CompanyDiscount);
                txt_currentjob_driver_discount.setText(DriverDiscount);
                txt_currentjob_payment_type.setText(PaymentType);
                txt_currentjob_booking_date.setText(BookingDate);
                txt_currentjob_booking_time.setText(BookingTime);
                txt_currentjob_pick_addr.setText(PickAddress);
                txt_currentjob_pick_latlong.setText(PickLatLng);
                txt_currentjob_drop_addr.setText(DropAddress);
                txt_currentjob_drop_latlong.setText(DropLatLng);
                txt_currentjob_estimated_time.setText(EstimatedTime);
                txt_currentjob_estimated_distance.setText(EstimatedDistance);
                txt_currentjob_passengers.setText(Passengers);
                txt_currentjob_bags.setText(Bags);
                txt_currentjob_wheelchairs.setText(WheelChairs);
                txt_currentjob_booking_status.setText(BookingStatus);
                txt_currentjob_booking_type.setText(BookingType);
                txt_currentjob_booking_info.setText(Info);
               // btn_trackjob_currentjob.performClick();
            }
            catch (Exception ex){
                Log.e("error",ex.getMessage());
            }


    }

    class getJobDetails extends AsyncTask<Void,Void,String>{
        ProgressDialog pd;
        String data = "";
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(CurrentJobDetail.this,"Taxi360taxi","Downloading",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);
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
            Log.e("printOut",s);
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
                String BookingType = arr.getJSONObject(0).getString("BookingType");
                String Info = arr.getJSONObject(0).getString("EntitiesDetails");
                appcontext.getInstance().pocket = Float.parseFloat(arr.getJSONObject(0).getString("Pocket"));
                txt_currentjob_booking_id.setText(booking_id_fromjson);
                txt_currentjob_passenger_name.setText(Name);
                txt_currentjob_passenger_id.setText(PassengerId);
                txt_currentjob_company_discount.setText(CompanyDiscount);
                txt_currentjob_driver_discount.setText(DriverDiscount);
                txt_currentjob_payment_type.setText(PaymentType);
                txt_currentjob_booking_date.setText(BookingDate);
                txt_currentjob_booking_time.setText(BookingTime);
                txt_currentjob_pick_addr.setText(PickAddress);
                txt_currentjob_pick_latlong.setText(PickLatLng);
                txt_currentjob_drop_addr.setText(DropAddress);
                txt_currentjob_drop_latlong.setText(DropLatLng);
                txt_currentjob_estimated_time.setText(EstimatedTime);
                txt_currentjob_estimated_distance.setText(EstimatedDistance);
                txt_currentjob_passengers.setText(Passengers);
                txt_currentjob_bags.setText(Bags);
                txt_currentjob_wheelchairs.setText(WheelChairs);
                txt_currentjob_booking_status.setText(BookingStatus);
                txt_currentjob_booking_type.setText(BookingType);
                txt_currentjob_booking_info.setText(Info);
                btn_trackjob_currentjob.performClick();
            }
            catch (Exception ex){
                Log.e("error",ex.getMessage());
            }
            pd.dismiss();
        }
    }

    public class completeJob extends AsyncTask<Void,Void,String>{
        String data="";
        ProgressDialog pd;
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(CurrentJobDetail.this,"Cabs Wiki","Submitting!",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            //jobstatus
            try {
                URL url = new URL(appcontext.getInstance().link);//"http://webservices.cabs.wiki/api/DriverApp/FnDispatchJobStatus");
                String params = "BookingId="+booking_id+"&Status=Dispatched&Cost="+ Ridecost +"&Payment="+payment+"&PaymentType="+payment_type+"&Details="+details+"&Currency="+currency;
                Log.e("log",params);
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
            pd.dismiss();
            appcontext.getInstance().backgroundstatus = "Available";
            appcontext.getInstance().mettercalled = 0;
            Toast.makeText(CurrentJobDetail.this, s, Toast.LENGTH_SHORT).show();
            CurrentJobDetail.this.finish();
        }
    }
// recall jobs should be changed to fncanceljobstatus with parameters bookingid,status,vehicleid,driverid,zoneid
    public class recallJob extends AsyncTask<Void,Void,String>{
        String data="";
        ProgressDialog pd;
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(CurrentJobDetail.this,"Cabs Wiki","Recalling!",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);//"http://webservices.cabs.wiki/api/DriverApp/DriverRecalledJob");
                String params = "BookingId="+booking_id;
                Log.e("jobrecal",params);
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
            pd.dismiss();
            Toast.makeText(CurrentJobDetail.this, s, Toast.LENGTH_SHORT).show();
            new sendNotificationToDispatcher().execute();
        }
    }

    public class sendNotificationToDispatcher extends AsyncTask<Void,Void,String>{
        String data="";
        ProgressDialog pd;
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(CurrentJobDetail.this,"Cabs Wiki","Sending Notification!",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);//"http://webservices.cabs.wiki/api/DriverApp/DispatcherPlayerID");
                String params = "CompanyId="+companyId;
                Log.e("yarakho",params);
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
            pd.dismiss();
            Log.e("dispatcher",s);
            try {
                JSONArray arr = new JSONArray(s);
                JSONObject obj = arr.getJSONObject(0);
                String playerId = obj.getString("PlayerId");

                JSONObject obj_tobesent = new JSONObject();
                JSONObject contents = new JSONObject();
                JSONArray include_player_ids = new JSONArray();
                JSONObject data = new JSONObject();
                contents.put("en","The job is recalled");
                data.put("driverId",3);
                include_player_ids.put(0,playerId);
                obj_tobesent.put("contents",contents);
                obj_tobesent.put("data",data);
                obj_tobesent.put("include_player_ids",include_player_ids);
                Log.e("maddy",obj_tobesent.toString());
//                OneSignal.postNotification(obj_tobesent, null);
                Toast.makeText(CurrentJobDetail.this, "Job Recalled", Toast.LENGTH_SHORT).show();
                CurrentJobDetail.this.finish();
            }
            catch (Exception ex){

            }
        }
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        MenuInflater infl = getMenuInflater();
        infl.inflate(R.menu.menu_detail_activities,menu);
        return super.onCreateOptionsMenu(menu);
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        switch (id){
            case R.id.show_on_map:
                Intent i = new Intent(CurrentJobDetail.this, MapsActivityJobLocation.class);
                i.putExtra("pick_latlong",txt_currentjob_pick_latlong.getText().toString());
                i.putExtra("drop_latlong",txt_currentjob_drop_latlong.getText().toString());
                startActivityForResult(i,11);
                break;
            case R.id.edit_job:
                passengerId = txt_currentjob_passenger_id.getText().toString();
                pickLatLng = txt_currentjob_pick_latlong.getText().toString();
                dropLatLng = txt_currentjob_drop_latlong.getText().toString();
                pickAddress = txt_currentjob_pick_addr.getText().toString();
                dropAddress = txt_currentjob_drop_addr.getText().toString();
                passengers = txt_currentjob_passengers.getText().toString();
                bags = txt_currentjob_bags.getText().toString();
                wheelchairs = txt_currentjob_wheelchairs.getText().toString();
                bookingStatus = txt_currentjob_booking_status.getText().toString();
                dateTime = txt_currentjob_booking_date.getText().toString() + " " + txt_currentjob_booking_time.getText().toString();
                estimatedTime = txt_currentjob_estimated_time.getText().toString();
                estimatedDistance = txt_currentjob_estimated_distance.getText().toString();
                bookingType = txt_currentjob_booking_type.getText().toString();
                info = txt_currentjob_booking_info.getText().toString();
                Bundle b = new Bundle();
                b.putInt("driverId",driverId);
                b.putString("passengerId",passengerId);
                b.putString("pickLatLng",pickLatLng);
                b.putString("dropLatLng",dropLatLng);
                b.putString("pickAddress",pickAddress);
                b.putString("dropAddress",dropAddress);
                b.putString("passengers",passengers);
                b.putString("bags",bags);
                b.putString("wheelchairs",wheelchairs);
                b.putString("bookingStatus",bookingStatus);
                b.putString("dateTime",dateTime);
                b.putString("estimatedTime",estimatedTime);
                b.putString("estimatedDistance",estimatedDistance);
                b.putString("info",info);
                b.putString("bookingType",bookingType);
                b.putString("bookingId",booking_id);
                Log.e("spinnerCheck",bookingType);
                Intent startBooking = new Intent(CurrentJobDetail.this, UpdateJob.class);
                startBooking.putExtra("bundle",b);
                startActivity(startBooking);
                String params = "PassengerId="+passengerId+"&DriverId="+driverId+"&PickLatLng="+pickLatLng+"&DropLatLng="+dropLatLng+"&PickAddress="+pickAddress+"&DropAddress="+dropAddress+"&Passengers="+passengers+"&Bags="+bags+"&WheelChairs="+wheelchairs+"&BookingStatus="+bookingStatus+"&DateTime="+dateTime+"&EstimatedDistance="+estimatedDistance+"&EstimatedTime="+estimatedDistance+"&BookingId="+bookingId;
                Log.e("params",params);
                break;
            case R.id.recall:
                new recallJob().execute();
                break;
        }
        return super.onOptionsItemSelected(item);
    }

    void MakecostEstimation() {
        StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data32",response.toString());
                        pd.dismiss();
                        postExecute(response);

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        pd.dismiss();
//                        Toast.makeText(CompletedJobDetail.this, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                params.put("BookingId", booking_id );
                String param = "TariffId,,"+appcontext.getInstance().Tarrifid+"" +
                        "&&Distance,,"+appcontext.getInstance().DistanceCovered +
                        "&&WaitingSeconds,,"+appcontext.getInstance().waitingseconds +
                        "&&DriverType,,"+appcontext.getInstance().Drivertype;

                Log.e("tarrifid: ",param);
                params.put("Parms", param);
                params.put("Action", "FnMeterCalcuation");
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



    boolean totalmobility_switch = false;
    float amounttobepaid = 0;
    int totalpassengercounter = 0;
    String publickey="cashonly";
    int No_of_passengers = 1;



    void postExecute(String s) {
        pd.dismiss();
        publickey="cashonly";
//        pref.put("activebookingid","");
        appcontext.getInstance().activebookingid = "";
        Log.e("mettercalculation",s);
        try {
            JSONArray arr = new JSONArray(s);
            JSONObject obj = arr.getJSONObject(0);
            Ridecost = obj.getString("RideCost");
            CompanyComission = obj.getString("CompanyComission");
            DriverCost = obj.getString("DriverCost");
            Waitingcost = obj.getString("WaitingCost");
            totalCost = obj.getString("TotalCost");


            //add not here
            if(!appcontext.getInstance().PromoId.equalsIgnoreCase("0")) {
                double percent = Double.parseDouble(Percentage);
                double Maxdis = Double.parseDouble(MaxDiscount);
                double basicpay = 40;//Double.parseDouble(BasicAmount);
                double newtotalcost = Double.parseDouble(totalCost);

                if (newtotalcost<=basicpay) {

                }else {
                    Log.e("codeexcuted",totalCost+""+percent);
                    if (promoType.equalsIgnoreCase("Percentage")) {
                        double discount = ((Double.parseDouble(totalCost) / 100) * percent);
                        Log.e("codeexcuted",discount+""+Maxdis);
                        if (discount > Maxdis) {
                            newtotalcost = Double.parseDouble(totalCost) - Maxdis;
                        } else if (discount <= Maxdis) {
                            newtotalcost = Double.parseDouble(totalCost) - discount;
                        }
                        Log.e("codeexcuted",newtotalcost+"");
                        if(newtotalcost<=basicpay){
                            newtotalcost = basicpay;
                            double diference = Double.parseDouble(totalCost) - newtotalcost;
                            double diferencePercntage = (100/ Double.parseDouble(totalCost) ) * diference;
                            Log.e("codeexcuted",Ridecost+"");
                            Ridecost =(Double.parseDouble(Ridecost)) - ((Double.parseDouble(Ridecost) * diferencePercntage)/ 100 ) + "";
                            CompanyComission = (Double.parseDouble(CompanyComission)) - (Double.parseDouble(CompanyComission) / 100) * diferencePercntage + "";
                            DriverCost = (Double.parseDouble(DriverCost)) - (Double.parseDouble(DriverCost) / 100) * diferencePercntage + "";
                            Waitingcost = (Double.parseDouble(Waitingcost)) - (Double.parseDouble(Waitingcost) / 100) * diferencePercntage + "";
                            totalCost = newtotalcost+"";
                        }else if(newtotalcost>basicpay) {
                            double diference = Double.parseDouble(totalCost) - newtotalcost;
                            double diferencePercntage = (100/ Double.parseDouble(totalCost) ) * diference;
                            Ridecost =(Double.parseDouble(Ridecost)) - ((Double.parseDouble(Ridecost) / 100) * diferencePercntage) + "";
                            CompanyComission = (Double.parseDouble(CompanyComission)) - (Double.parseDouble(CompanyComission) / 100) * diferencePercntage + "";
                            DriverCost = (Double.parseDouble(DriverCost)) - (Double.parseDouble(DriverCost) / 100) * diferencePercntage + "";
                            Waitingcost = (Double.parseDouble(Waitingcost)) - (Double.parseDouble(Waitingcost) / 100) * diferencePercntage + "";
                            totalCost = newtotalcost+"";
                        }
                    }else if (promoType.equalsIgnoreCase("Value")){

                        newtotalcost = Double.parseDouble(totalCost) - Maxdis;
                        if(newtotalcost<basicpay){
                            newtotalcost = basicpay;
                            double diference = Double.parseDouble(totalCost) - newtotalcost;
                            double diferencePercntage = (Double.parseDouble(totalCost) / 100) * diference;
                            Ridecost =(Double.parseDouble(Ridecost)) - ((Double.parseDouble(Ridecost) / 100) * diferencePercntage) + "";
                            CompanyComission = (Double.parseDouble(CompanyComission)) - (Double.parseDouble(CompanyComission) / 100) * diferencePercntage + "";
                            DriverCost = (Double.parseDouble(DriverCost)) - (Double.parseDouble(DriverCost) / 100) * diferencePercntage + "";
                            Waitingcost = (Double.parseDouble(Waitingcost)) - (Double.parseDouble(Waitingcost) / 100) * diferencePercntage + "";
                            totalCost = newtotalcost+"";
                        }else {
                            double diference = Double.parseDouble(totalCost) - newtotalcost;
                            double diferencePercntage = (Double.parseDouble(totalCost) / 100) * diference;
                            Ridecost =(Double.parseDouble(Ridecost)) - ((Double.parseDouble(Ridecost) / 100) * diferencePercntage) + "";
                            CompanyComission = (Double.parseDouble(CompanyComission)) - (Double.parseDouble(CompanyComission) / 100) * diferencePercntage + "";
                            DriverCost = (Double.parseDouble(DriverCost)) - (Double.parseDouble(DriverCost) / 100) * diferencePercntage + "";
                            Waitingcost = (Double.parseDouble(Waitingcost)) - (Double.parseDouble(Waitingcost) / 100) * diferencePercntage + "";
                            totalCost = newtotalcost+"";
                        }
                    }
            }


            }

            String currName = obj.getString("Code");
            currencycode = currName;
            payment = totalCost;
            publickey = obj.getString("PublicKey");
            totalCost = totalCost +" " + currName;
            Log.e("Ridecost",totalCost);
        }
        catch (Exception ex){
            Log.e("Ridecost","something went wrong"+ex.getMessage());
            ex.printStackTrace();

        }

          if(Float.parseFloat(totalCost.split(" ")[0])<=appcontext.getInstance().pocket){
            amounttobepaid = 0;
          }else {
            amounttobepaid =  Float.parseFloat(totalCost.split(" ")[0]) - appcontext.getInstance().pocket;
          }
        sendmessagedata("");
        alert = new AlertDialog.Builder(CurrentJobDetail.this).create();
        final View v = getLayoutInflater().inflate(R.layout.popup_costnew,null);
        TextView txtDistance = (TextView)v.findViewById(R.id.txt_popopcost_distancecovered);
        TextView txtDuration = (TextView)v.findViewById(R.id.txt_popopcost_duration);
        TextView txtRidecost = (TextView)v.findViewById(R.id.txt_popopcost_Ride);
        TextView txtComission = (TextView)v.findViewById(R.id.txt_popopcommission);
        TextView txtDriverCost = (TextView)v.findViewById(R.id.txt_popopDriverCost);
        TextView txtWaitingCost = (TextView)v.findViewById(R.id.txt_popopcost_Waitingcost);
        TextView txtTotalcost = (TextView)v.findViewById(R.id.txt_popopcost_Totalcost);
        final EditText edittext_paidamount = (EditText)v.findViewById(R.id.edittxt_paid_ammount);
        final EditText edittext_account_payment = (EditText)v.findViewById(R.id.account_payment);
        final CardInputWidget cardInputWidget = (CardInputWidget)v.findViewById(R.id.card_input_widget);
        final Button btn_pay_popup_cost = (Button) v.findViewById(R.id.btn_pay_popup_cost);
        final RadioGroup radioGroup = (RadioGroup)v.findViewById(R.id.groupradiopayment);
        final RadioButton cashRadio = (RadioButton)v.findViewById(R.id.cashradio) ;
        final RadioButton cardRadio = (RadioButton)v.findViewById(R.id.cardradio) ;
        final RadioButton apppost = (RadioButton)v.findViewById(R.id.apppost) ;
        final RadioButton account_paymentRadio = (RadioButton)v.findViewById(R.id.account);
        final RadioButton totalMobility = (RadioButton)v.findViewById(R.id.totalMobility);
        final LinearLayout totalMobility_card_view = (LinearLayout) v.findViewById(R.id.totalMobility_card_view);


        radioGroup.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(RadioGroup group, int checkedId) {
                if( ((RadioButton)group.findViewById(checkedId)).getText()
                        .toString().equalsIgnoreCase("Account")){
                    RideType = "Account";
                }else {
                    RideType = "Normal";
                }
            }
        });

        final TextView txt_totalmobility_count = (TextView)v.findViewById(R.id.txt_totalmobility_count);
        final TextView txt_totalmobility_paymenttitle = (TextView)v.findViewById(R.id.txt_totalmobility_paymenttitle);
        final EditText txt_totalmobility_passenger_name = (EditText)v.findViewById(R.id.txt_totalmobility_passenger_name);
        final EditText txt_totalmobility_id = (EditText)v.findViewById(R.id.txt_totalmobility_id);
        final TextView txt_totalmobility_time = (TextView)v.findViewById(R.id.txt_totalmobility_time);
        final EditText txt_totalmobility_serial = (EditText)v.findViewById(R.id.txt_totalmobility_serial);
        final EditText txt_totalmobility_paidamount = (EditText)v.findViewById(R.id.txt_totalmobility_paidamount);



        totalMobility.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {

                if(!totalmobility_switch) {
                    TotalMobilityStatus = true;
                   final AlertDialog alert = new AlertDialog.Builder(CurrentJobDetail.this).create();

                    final View v = getLayoutInflater().inflate(R.layout.numberpicker,null);


                    NumberPicker np = (NumberPicker) v.findViewById(R.id.numberPicker);
                    TextView txt_done = (TextView) v.findViewById(R.id.textView);

                    txt_done.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            try {
                                alert.cancel();
                                alert.dismiss();
                            }catch (Exception e){
                                e.printStackTrace();
                            }
                            txt_totalmobility_count.setText(totalpassengercounter+"");
                            totalMobility_card_view.setVisibility(View.VISIBLE);
                            btn_pay_popup_cost.setText("Next");


                            totalpassengercounter = No_of_passengers;
                            float indiv_fare = 0;
                            if(amounttobepaid>50.0f){

                                indiv_fare = (amounttobepaid/ totalpassengercounter )-((amounttobepaid/totalpassengercounter) / 100 * 25);
                                TotalMobilityDiscount = "25%";

                            }else {
                                indiv_fare =(amounttobepaid/ totalpassengercounter )-((amounttobepaid/totalpassengercounter) / 100 * 50);
                                TotalMobilityDiscount = "50%";
                            }


                            txt_totalmobility_paymenttitle.setText("Individual fare "+indiv_fare);
                            totalmobility_switch = true;
                        }
                    });

                    np.setMinValue(1);
                    np.setMaxValue(15);

                    np.setOnValueChangedListener(new NumberPicker.OnValueChangeListener() {
                        @Override
                        public void onValueChange(NumberPicker picker, int oldVal, int newVal) {
                            No_of_passengers = picker.getValue();
                            totalpassengercounter = picker.getValue();
                            Log.e("picker",No_of_passengers+"");
                        }
                    });
                    alert.setView(v);
                    alert.show();

                }
                else {
                    btn_pay_popup_cost.setText("Pay");
                    totalMobility_card_view.setVisibility(View.GONE);
                    totalmobility_switch =false;
                }

//                TotalMobilityStatus =totalmobility_switch;

            }
        });

        cashRadio.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                cardInputWidget.setVisibility(View.GONE);
                edittext_account_payment.setVisibility(View.GONE);
            }
        });

        cardRadio.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                cardInputWidget.setVisibility(View.VISIBLE);
                edittext_account_payment.setVisibility(View.GONE);
                payment_type = "cash";

            }
        });

        apppost.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                payment_type = "apppost";
            }
        });

        account_paymentRadio.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                edittext_account_payment.setVisibility(View.VISIBLE);
                payment_type = "account";

            }
        });


        cashRadio.performClick();
        if(publickey.equalsIgnoreCase("cashonly")){
            cardRadio.setVisibility(View.GONE);
        }else{
            cardRadio.setVisibility(View.VISIBLE);
        }
        double waitingtimeinseconds =  appcontext.getInstance().waitingseconds;
        double waitingminutes  = (waitingtimeinseconds % 3600) / 60;
        Log.e("waitingtimeMinutes",waitingminutes+"");
        txtDistance.setText(""+appcontext.getInstance().DistanceCovered +" KM");

        txtDuration.setText(appcontext.getInstance().timeclock);
        try {

            txtComission.setText( CompanyComission+" " + totalCost.split(" ")[1]);// for country code
            txtDriverCost.setText( DriverCost+" " + totalCost.split(" ")[1]);// for country code
            txtRidecost.setText( Ridecost+" " + totalCost.split(" ")[1]);// for country code
            txtWaitingCost.setText(  Waitingcost+" " + totalCost.split(" ")[1] );// for country code
//            txtTotalcost.setText( totalCost.split(" ")[0] +" " + totalCost.split(" ")[1]);// for country code
            if (appcontext.getInstance().isJobfixedRat) {
                txtTotalcost.setText("Fixed price "+ appcontext.getInstance().fixedprice +" " + totalCost.split(" ")[1]);// for country code
            } else{
                txtTotalcost.setText( amounttobepaid +" " + totalCost.split(" ")[1]);// for country code
            }

        }catch (Exception e){
            txtRidecost.setText( Ridecost+" " + totalCost.split(" ")[1]);// for country code
            txtWaitingCost.setText(  Waitingcost+" " + totalCost.split(" ")[1] );// for country code
//            txtTotalcost.setText( totalCost.split(" ")[0] +" " + totalCost.split(" ")[1]);// for country code
            if (appcontext.getInstance().isJobfixedRat) {
                txtTotalcost.setText("Fixed price "+ appcontext.getInstance().fixedprice +" " + totalCost.split(" ")[1]);// for country code
            } else{
                txtTotalcost.setText( amounttobepaid +" " + totalCost.split(" ")[1]);// for country code
            }
        }

        txt_totalmobility_time.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                DatePickerDialog dialog = new DatePickerDialog(CurrentJobDetail.this,
                        new DatePickerDialog.OnDateSetListener() {
                            @Override
                            public void onDateSet(DatePicker view, int year, int month, int dayOfMonth) {
                                txt_totalmobility_time.setText(dayOfMonth+"/"+month+"/"+year);
                            }
                        }, 2018, 7, 18);
                dialog.show();
            }
        });


        btn_pay_popup_cost.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (btn_pay_popup_cost.getText().toString().equalsIgnoreCase("next")) {
                         if(totalpassengercounter==0){
                             btn_pay_popup_cost.setText("Finish Payments");

                         }else{
                             try {
                                 String cardholder_name = txt_totalmobility_passenger_name.getText().toString(),
                                         cardholder_id = txt_totalmobility_id.getText().toString(),
                                         cardholder_expDate = txt_totalmobility_time.getText().toString(),
                                         cardholder_seriel = txt_totalmobility_serial.getText().toString(),
                                         totalMObilitypaidamount = txt_totalmobility_paidamount.getText().toString();

                                 Maketotalmobilitypyamentrequest(cardholder_name,
                                         cardholder_id, cardholder_expDate,
                                         cardholder_seriel, totalMObilitypaidamount);

                                 txt_totalmobility_passenger_name.setText("");
                                 txt_totalmobility_id.setText("");
                                 txt_currentjob_booking_date.setText("");
                                 txt_totalmobility_serial.setText("");
                                 txt_totalmobility_paidamount.setText("");

                                 totalpassengercounter--;
                                 if(totalpassengercounter==0){
                                     totalMobility_card_view.setVisibility(View.GONE);
                                 }
                                 txt_totalmobility_count.setText(totalpassengercounter+"");

                             }catch (Exception e){
                                 e.printStackTrace();
                             }
                         }


                } else {

                    if (!edittext_paidamount.getText().toString().isEmpty()) {
                    paidamount = edittext_paidamount.getText().toString();
                    pd = ProgressDialog.show(CurrentJobDetail.this, "360taxitaxi", "Submitting!", false, false);
                    if (cardRadio.isChecked()) {
                        // Card cardToSave = cardInputWidget.getCard();
                        final Card card = cardInputWidget.getCard();
                        SourceParams cardSourceParams = SourceParams.createCardParams(card);
// The asynchronous way to do it. Call this method on the main thread.
                        final Stripe mStripe = new Stripe(CurrentJobDetail.this);
                        mStripe.setDefaultPublishableKey(publickey);
                        mStripe.createToken(card, new TokenCallback() {
                            @Override
                            public void onError(Exception error) {
                                Toast.makeText(CurrentJobDetail.this, "Transaction Error", Toast.LENGTH_SHORT).show();

                            }

                            @Override
                            public void onSuccess(Token token) {
                                //MakePaymentRequest(token);
                                String name = "", No = "", bankn = "";
                                try {

                                    name = token.getBankAccount().getAccountHolderName();
                                } catch (Exception e) {

                                }
                                try {
                                    No = token.getBankAccount().getAccountNumber();
                                } catch (Exception e) {

                                }
                                try {
                                    bankn = token.getBankAccount().getBankName();
                                } catch (Exception e) {

                                }
                                payment_type = "Credit Card";
                                details = "AccountHolderName:" + name + ", AccountNo:" + No + ", BankName:" + bankn;

                                Toast.makeText(CurrentJobDetail.this, "Transaction successfull", Toast.LENGTH_SHORT).show();
                                Log.e("tokenid:", token.getId());
                                MakepaymentRequest(companyId, token.getId(), Ridecost);

                                btn_pay_popup_cost.setClickable(true);
                                //        new completeJob().execute();
                            }
                        });


                     /*   if (card == null) {
                           Toast.makeText(CurrentJobDetail.this, "Invalid Card Data", Toast.LENGTH_SHORT).show();
                        } else {
                          new completeJob().execute();
                        }*/
                    } else {

                        if(totalMobility.isChecked()){
                            RideType = "Total Mobility";
                        }

                        btn_pay_popup_cost.setClickable(true);
                        details = "Direct Payment";

                        payment_type = "Cash Only";
                        MakeJobstatusrequest();
                        // new completeJob().execute();
                    }
                } else {
                    Toast.makeText(CurrentJobDetail.this, "Please enter paid amount in box!", Toast.LENGTH_SHORT).show();
                }
            }
            }
        });
        alert.setView(v);
        alert.setCancelable(false);
        alert.show();
    }

    private void Maketotalmobilitypyamentrequest(final String cardholder_name, final String cardholder_id,
                                                 final String cardholder_expDate, final String cardholder_seriel, final String totalMObilitypaidamount) {

//        loading = (LinearLayout) findViewById(R.id.loadingbarcurrent);
//        loading.setVisibility(View.VISIBLE);

        StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link ,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("Totalmob",response.toString());
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")){
                        }else {


                        }

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();


//                        Toast.makeText(CurrentJobDetail.this, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();

                params.put("Parms",
                        "BookingId,,"+booking_id+"" +
                        "&&CardHolderName,,"+cardholder_name+"" +
                        "&&CardId,,"+cardholder_id+"" +
                        "&&CardSerailNo,,"+cardholder_seriel+"" +
                        "&&RideCost,,"+Ridecost+"" +
                        "&&Expiry,,"+cardholder_expDate+"" +
                        "&&Paid,,"+totalMObilitypaidamount+"");

                params.put("Action", "FnTotalMobilityDetails");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);


                Log.e("Totalmob",params.toString());
                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);

    }

    void sendmessagedata(String s) {
//        Toast.makeText(ChatActivity.this, s, Toast.LENGTH_SHORT).show();
//        etxt_sendmessage_chat.setText("");
    try {
        try{


            if(!appcontext.getInstance().JobArrivedDeviceType.equalsIgnoreCase("Dispatcher")){

                HashMap<String, Object> data = new HashMap<>();
                data.put("status", "completed");
                data.put("distance", appcontext.getInstance().DistanceCovered);
                data.put("duration", appcontext.getInstance().timeclock);
                data.put("waitingcost",Waitingcost);
                data.put("totalcost",totalCost.split(" ")[0]);
                data.put("DriverId",driverId);
                data.put("VehicleId",pref.getString("SelectedVehicleid"));
                data.put("BookingId",booking_id);

                try{

                    appcontext.getInstance().paramsforsms = new HashMap<>();
                    appcontext.getInstance().number = txt_currentjob_passenger_id.getText().toString();
                    appcontext.getInstance().paramsforsms.put("Code",appcontext.getInstance().smscode);
                    appcontext.getInstance().paramsforsms.put("RideDistance",appcontext.getInstance().DistanceCovered);
                    appcontext.getInstance().paramsforsms.put("RideTime",appcontext.getInstance().timeclock);
                    appcontext.getInstance().paramsforsms.put("RideCost",Ridecost);
                    appcontext.getInstance().paramsforsms.put("RideWaiting",Waitingcost);
                    appcontext.getInstance().paramsforsms.put("TotalCost",totalCost.split(" ")[0]);
                    appcontext.getInstance().MakesmsRequest(appcontext.getInstance().con.getString(R.string.FnTotalFareText));


                }catch (Exception e){
                    e.printStackTrace();
                }
                FirebaseDatabase.getInstance().getReference()
                        .child("Passengerjobs")
                        .child(appcontext.getInstance().JobArrivedDeviceUid)
                        .setValue(data);

            }
            FirebaseDatabase.getInstance().getReference()
                    .child("notification")
                    .child(appcontext.getInstance().DriverId).setValue(null);
        }catch (Exception e){
            e.printStackTrace();
        }


        Log.e("player_id",appcontext.getInstance().playerID);
        JSONObject obj = new JSONObject();
        JSONObject contents = new JSONObject();
        JSONArray include_player_ids = new JSONArray();
        JSONObject data = new JSONObject();
        contents.put("en","job completed");

        data.put("distance",appcontext.getInstance().DistanceCovered);
        data.put("duration",appcontext.getInstance().timeclock);
        data.put("waitingcost",Waitingcost);
        data.put("totalcost",totalCost.split(" ")[0]);
        data.put("DriverId",driverId);
        include_player_ids.put(0,appcontext.getInstance().playerID);
        obj.put("contents",contents);
        obj.put("data",data);
        obj.put("include_player_ids",include_player_ids);
        Log.e("maddy",obj.toString());

        //Log.e("player_id",date_tobe_sent);
//        OneSignal.postNotification(obj, new OneSignal.PostNotificationResponseHandler() {
//            @Override
//            public void onSuccess(JSONObject response) {
//                Log.e("msgsucess",response.toString());
//            }
//
//            @Override
//            public void onFailure(JSONObject response) {
//                Log.e("msgNotfail",response.toString());
//            }
//        });

    } catch (JSONException e) {
        Log.e("player_id",e.getMessage());
    }
    Log.e("resp",s);
}


    void MakepaymentRequest(final String companyIdd, final String tokenid, final String Costfare) {

     StringRequest   postRequest = new StringRequest(Request.Method.POST, getApplicationContext().getResources().getString(R.string.ChargeCustomer),
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("striperesponse",response.toString());
                        if(response.equalsIgnoreCase("succeeded")){
                            pd.dismiss();
                            MakeJobstatusrequest();
                        }else{

                            try{
                                pd.dismiss();
                            }catch (Exception e){
                                e.printStackTrace();
                            }

                            Log.e("response",response.toString());
                            Toast.makeText(CurrentJobDetail.this, "Something went wrong Please collect the money in cash", Toast.LENGTH_LONG).show();
                        }
                        // pd.dismiss();
                       // setdata(response.toString());

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                       // Toast.makeText(c, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
                params.put("CompanyId", companyIdd );
                int totalfare =(int)  Float.parseFloat(Costfare);
                params.put("Amount", totalfare+"" );
                params.put("TokenId", tokenid );
                params.put("Currency",currencycode);
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
//
//                params.put("Parms", "CompanyId,,"+companyIdd+"&&Amount,,"+companyIdd+"&&TokenId,,"+companyIdd+"&&Currency,,"+companyIdd);
//                params.put("Action", "ChargeCustomer");
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
    void MakeJobstatusrequest() {

        alert.cancel();
        StringRequest   postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("statuschanged",response.toString());
//                        (new Current()).btn_available_fragmentCurrent.performClick();
                        try {
                            Toast.makeText(CurrentJobDetail.this, new JSONArray(response).getJSONObject(0).getString("Result"), Toast.LENGTH_SHORT).show();
                        } catch (JSONException e) {
                            e.printStackTrace();
                        }

                        appcontext.getInstance().metterstatus = "finished";
                        appcontext.getInstance().mettercalled = 0;
                        appcontext.getInstance().DistanceCovered = "0.0";
                        appcontext.getInstance().utilmetterdistance = 0.00;
                        appcontext.getInstance().pathformetter = new ArrayList<>();
                        appcontext.getInstance().timeclock = "00:00:00";
                        appcontext.getInstance().backgroundstatus = "Available";
                        appcontext.getInstance().waitingminutes = 0;
                        appcontext.getInstance().waitingseconds = 0;
                        appcontext.getInstance().totalseconds = 0;
                        appcontext.getInstance().pickup ="";
                        appcontext.getInstance().dropoff = "";
                        appcontext.getInstance().fare = "0.00";
                        appcontext.getInstance().pocket = 0f;


                        appcontext.getInstance().isTarrifSelectionVisible = true;
                        appcontext.getInstance().isJobfixedRat = false;
                        appcontext.getInstance().JobArrivedDetails = "[]";



                        FirebaseDatabase.getInstance().getReference()
                                .child("jobs").child(pref.getString("company_id"))
                                .child(pref.getString("SelectedVehicleid") + "")
                                .child(FirebaseAuth.getInstance().getCurrentUser().getUid() + "")
                                .setValue(null);


                        appcontext.getInstance().backgroundstatus="Available";
                        appcontext.getInstance().ChangestatusRequest();

                        CurrentJobDetail.this.finish();
                        startActivity(new Intent(CurrentJobDetail.this, JobView.class));
                        // pd.dismiss();
                        // setdata(response.toString());
                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        // Toast.makeText(c, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//
                try {
//                    params.put("ZoneId", appcontext.getInstance().currentzone);
                     String timeanddate = "";
                    try{
                        DateTime someDate = new DateTime(Long.valueOf(appcontext.getInstance().realtimelocation.getTime()), DateTimeZone.getDefault());
                        timeanddate =  someDate.toString().replace("T"," ").split("\\.")[0];
                   Log.e("ridetimestop",timeanddate);
                    }catch (Exception e){
                        e.printStackTrace();
                    }

                    if(appcontext.getInstance().isJobfixedRat){
                        totalCost.split(" ")[0] = appcontext.getInstance().fixedprice;
                    }
                    appcontext.getInstance().pocket = 0f;
                    params.put("UserKey", appcontext.getInstance().passforlink);
                    params.put("Token", appcontext.getInstance().token);
                    params.put("Action", "FnDispatchJobStatus");
                    params.put("Parms",
                            "DropZoneId,,"+appcontext.getInstance().currentzone+
                            "&&CompanyComission,,"+CompanyComission+
                            "&&DriverCost,,"+DriverCost+
                              "&&TotalTime,,"+appcontext.getInstance().timeclock+
                              "&&WaitingTime,,"+appcontext.getInstance().waitingtime+
                              "&&RideCost,,"+Ridecost+
                              "&&WaitingRate,,"+Waitingcost+
                             "&&BookingId,,"+booking_id+"" +
                            "&&Status,,"+"Dispatched"+"" +
                            "&&Cost,,"+ totalCost.split(" ")[0] +"" +
                            "&&Payment,,"+paidamount+"" +
                            "&&PaymentType,,"+payment_type+"" +
                            "&&Details,,"+details+"" +
                            "&&Currency,,"+currencycode+"" +
                            "&&DropLatLng,,"+appcontext.getInstance().droplatlng+"" +
                            "&&DropLocation,,"+appcontext.getInstance().droplocation+"" +
                            "&&DriverId,,"+driverId+"" +
                             "&&ZoneId,,"+appcontext.getInstance().currentzone+"" +
                             "&&Completedtime,,"+timeanddate+
                             "&&Distance,,"+appcontext.getInstance().DistanceCovered+
                             "&&TotalMobilityStatus,,"+TotalMobilityStatus+
                             "&&TotalMobilityDiscount,,"+TotalMobilityDiscount+
                             "&&JobType,,"+RideType
                    );

                    Log.e("fndispatchparam",params.toString());
                }catch (Exception e){
                    Log.e("fndispatchparam",e.getMessage()+"");

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
//        Volley.newRequestQueue(this).add(postRequest);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 11 && resultCode == RESULT_OK){
            completeDistance = data.getDoubleExtra("estimatedDistance",0);
            completejob();
        }
    }

    @Override
    protected void onStart() {
        super.onStart();

    }
//need to add distance latter
    void completejob(){
        completeTime = appcontext.getInstance().timeclock;
        Log.e("rcvdValue", ""+completeDistance);
        Log.e("rcvdValuetime", ""+completeTime);
        pd = ProgressDialog.show(CurrentJobDetail.this,"Cabs Wiki","Estimating Cost!",false,false);
      //add not here
       if (!appcontext.getInstance().PromoId.equalsIgnoreCase("0")){
           GetPromoDetailsFromserver();
       }else {
           MakecostEstimation();
       }
//        new costEstimation().execute();
    }

        void GetPromoDetailsFromserver() {
            StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                    new Response.Listener<String>() {
                        @Override
                        public void onResponse(String response) {
                            Log.d("promodetails",response.toString());
                            try {
                                JSONArray jsonArray = new JSONArray(response);
                                BasicAmount =  jsonArray.getJSONObject(0).getString("BasicAmount");
                                MaxDiscount =  jsonArray.getJSONObject(0).getString("MaxDiscount");
                                Percentage =  jsonArray.getJSONObject(0).getString("Percentage");
                                promoType =  jsonArray.getJSONObject(0).getString("Type");

                            }catch (Exception e){
                                e.printStackTrace();
                            }
                            MakecostEstimation();
                        }
                    },
                    new Response.ErrorListener() {
                        @Override
                        public void onErrorResponse(VolleyError error) {
                            error.printStackTrace();
                            pd.dismiss();
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
}
