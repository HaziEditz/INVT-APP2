package com.khybertech.taxi360driver.JobView;

import android.app.ProgressDialog;
import android.graphics.drawable.ColorDrawable;
import android.os.AsyncTask;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.support.v7.widget.Toolbar;
import android.util.Log;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
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

public class CompletedJobDetail extends AppCompatActivity {

    String booking_id;
    TextView txt_completedjob_booking_id,txt_completedjob_passenger_name,txt_completedjob_passenger_id,
            txt_completedjob_company_discount,txt_completedjob_driver_discount,txt_completedjob_payment_type,txt_completedjob_booking_date,
            txt_completedjob_booking_time,txt_completedjob_pick_addr,txt_completedjob_pick_latlong,txt_completedjob_drop_addr,
            txt_completedjob_drop_latlong,txt_completedjob_estimated_time,txt_completedjob_estimated_distance,txt_completedjob_passengers,
            txt_completedjob_bags,txt_completedjob_wheelchairs,txt_completedjob_booking_status;
    Toolbar toolbar_completed_job_detail;


    ProgressDialog pd;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_completed_job_detailnew);
        widgts();
        setSupportActionBar(toolbar_completed_job_detail);
        booking_id = getIntent().getExtras().getString("booking_id","null");


        pd = ProgressDialog.show(this, null, null, true);
        pd.setContentView(R.layout.loading);
        pd.getWindow().setBackgroundDrawable(new ColorDrawable(android.graphics.Color.TRANSPARENT));

        MakePostRequest();
        //new getJobDetails().execute();
    }

    void MakePostRequest() {
        StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data32",response.toString());
                        pd.dismiss();
                        PostExecute(response);

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        pd.dismiss();
                        Toast.makeText(CompletedJobDetail.this, "network error", Toast.LENGTH_SHORT).show();
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

    void PostExecute(String s) {

        try {
//            JSONObject obj = new JSONObject(s);
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
            String corneraddres = arr.getJSONObject(0).getString("CornerAddress");
            txt_completedjob_booking_id.setText(booking_id_fromjson);
            txt_completedjob_passenger_name.setText(Name);
            txt_completedjob_passenger_id.setText(PassengerId);
            txt_completedjob_company_discount.setText(CompanyDiscount);
            txt_completedjob_driver_discount.setText(DriverDiscount);
            txt_completedjob_payment_type.setText(PaymentType);
            txt_completedjob_booking_date.setText(BookingDate);
            txt_completedjob_booking_time.setText(BookingTime);
            txt_completedjob_pick_addr.setText(PickAddress);
            txt_completedjob_pick_latlong.setText(corneraddres);
            txt_completedjob_drop_addr.setText(DropAddress);
            txt_completedjob_drop_latlong.setText(DropLatLng);
            txt_completedjob_estimated_time.setText(EstimatedTime);
            txt_completedjob_estimated_distance.setText(EstimatedDistance);
            txt_completedjob_passengers.setText(Passengers);
            txt_completedjob_bags.setText(Bags);
            txt_completedjob_wheelchairs.setText(WheelChairs);
            txt_completedjob_booking_status.setText(BookingStatus);
        }
        catch (Exception ex){
            Log.e("error",ex.getMessage());
        }
        pd.dismiss();
    }









    private void widgts() {
        txt_completedjob_booking_id = (TextView) findViewById(R.id.txt_completedjob_booking_id);
        txt_completedjob_passenger_name = (TextView) findViewById(R.id.txt_completedjob_passenger_name);
        txt_completedjob_passenger_id = (TextView) findViewById(R.id.txt_completedjob_passenger_id);
        txt_completedjob_company_discount = (TextView) findViewById(R.id.txt_completedjob_company_discount);
        txt_completedjob_driver_discount = (TextView) findViewById(R.id.txt_completedjob_driver_discount);
        txt_completedjob_payment_type = (TextView) findViewById(R.id.txt_completedjob_payment_type);
        txt_completedjob_booking_date = (TextView) findViewById(R.id.txt_completedjob_booking_date);
        txt_completedjob_booking_time = (TextView) findViewById(R.id.txt_completedjob_booking_time);
        txt_completedjob_pick_addr = (TextView) findViewById(R.id.txt_completedjob_pick_addr);
        txt_completedjob_pick_latlong = (TextView) findViewById(R.id.txt_completedjob_pick_latlong);
        txt_completedjob_drop_addr = (TextView) findViewById(R.id.txt_completedjob_drop_addr);
        txt_completedjob_drop_latlong = (TextView) findViewById(R.id.txt_completedjob_drop_latlong);
        txt_completedjob_estimated_time = (TextView) findViewById(R.id.txt_completedjob_estimated_time);
        txt_completedjob_estimated_distance = (TextView) findViewById(R.id.txt_completedjob_estimated_distance);
        txt_completedjob_passengers = (TextView) findViewById(R.id.txt_completedjob_passengers);
        txt_completedjob_bags = (TextView) findViewById(R.id.txt_completedjob_bags);
        txt_completedjob_wheelchairs = (TextView) findViewById(R.id.txt_completedjob_wheelchairs);
        txt_completedjob_booking_status = (TextView) findViewById(R.id.txt_completedjob_booking_status);
        toolbar_completed_job_detail = (Toolbar) findViewById(R.id.toolbar_completed_job_detail);
    }

    class getJobDetails extends AsyncTask<Void,Void,String> {
        ProgressDialog pd;
        String data = "";
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(CompletedJobDetail.this,"CabsWiki","Downloading",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);
                String params = "BookingId="+booking_id;
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(1000);
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
                txt_completedjob_booking_id.setText(booking_id_fromjson);
                txt_completedjob_passenger_name.setText(Name);
                txt_completedjob_passenger_id.setText(PassengerId);
                txt_completedjob_company_discount.setText(CompanyDiscount);
                txt_completedjob_driver_discount.setText(DriverDiscount);
                txt_completedjob_payment_type.setText(PaymentType);
                txt_completedjob_booking_date.setText(BookingDate);
                txt_completedjob_booking_time.setText(BookingTime);
                txt_completedjob_pick_addr.setText(PickAddress);
                txt_completedjob_pick_latlong.setText(PickLatLng);
                txt_completedjob_drop_addr.setText(DropAddress);
                txt_completedjob_drop_latlong.setText(DropLatLng);
                txt_completedjob_estimated_time.setText(EstimatedTime);
                txt_completedjob_estimated_distance.setText(EstimatedDistance);
                txt_completedjob_passengers.setText(Passengers);
                txt_completedjob_bags.setText(Bags);
                txt_completedjob_wheelchairs.setText(WheelChairs);
                txt_completedjob_booking_status.setText(BookingStatus);
            }
            catch (Exception ex){
                Log.e("error",ex.getMessage());
            }
            pd.dismiss();
        }
    }
}
