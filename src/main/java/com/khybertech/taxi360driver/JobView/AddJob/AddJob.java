package com.khybertech.taxi360driver.JobView.AddJob;

import android.app.DatePickerDialog;
import android.app.ProgressDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.preference.PreferenceManager;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.support.v7.widget.Toolbar;
import android.util.Log;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.DatePicker;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.TimePicker;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.Maps.DestinationActivity;
import com.khybertech.taxi360driver.Maps.Pickupactivity;
import com.khybertech.taxi360driver.R;
import com.google.android.gms.maps.model.LatLng;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;

public class AddJob extends AppCompatActivity {

    Toolbar toolbar_addjob;
    Button confirm ;
    Spinner spinner_addjob_bookingtype,spinner_addjob_passengers,spinner_addjob_bags,spinner_addjob_wheelchairs,spinner_addjob_vehicletype;
    String[] spinner_data_bookingtype = {"Full Vehicle","Share Vehicle"};
    String[] spinner_data = {"0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20"};
    String[] headings_lv = {"Passenger ID","Pick Address","Drop Address","Vehicle Type","Booking Type","Passengers","Bags","Wheel Chairs","Info","Date & Time","Estimated Distance","Estimated Time","Name"};
    String[] spinner_data_vehicle_type;
    LinearLayout layout_addjob_pickaddress,layout_addjob_dropaddress,layout_datetime;
    String nameReceived = "";
    String companyId = "";
    String passengerId;
    int driverID;
    String dateToBeSent = "";
    LatLng locReceived = null;
    SharedPreferences pref;
    TextView txt_pickaddr_pickup,txt_dropaddr_pickup,txt_addjob_time,txt_addjob_distance;
    TimePickerDialog timeDialog;
    DatePickerDialog dateDialog;
    DatePickerDialog.OnDateSetListener date;
    TextView txt_datetime_pickup;
    double lat_origin,lng_origin,lat_dest,lng_dest;
    EditText etxt_passenger_id,etxt_addjob_passengername,etxt_addjob_extrainfo;
    HashMap<String,Object> hm_holding_vehicletype_id;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_add_job);
        widgets();
        toolbarSetup();
        setUpbookingTypeSpinner();
        hm_holding_vehicletype_id = new HashMap<>();
        pref = PreferenceManager.getDefaultSharedPreferences(AddJob.this);
        companyId = pref.getString("company_id","0");
        driverID = Integer.parseInt(appcontext.getInstance().DriverId);
        MakeloadVehicleTypeRequest();
//        new loadVehicleType().execute();
        layout_addjob_pickaddress.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                startActivityForResult(new Intent(AddJob.this, Pickupactivity.class),010);
            }
        });

        layout_addjob_dropaddress.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (!nameReceived.equalsIgnoreCase("")) {
                    startActivityForResult(new Intent(AddJob.this, DestinationActivity.class), 011);
                }
                else {
                    Toast.makeText(AddJob.this, "Select Pick Up Location First", Toast.LENGTH_SHORT).show();
                }
            }
        });
        confirm.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (etxt_passenger_id.getText().toString().equalsIgnoreCase("")){
                    Toast.makeText(AddJob.this, "Enter Passenger ID", Toast.LENGTH_SHORT).show();
                }
                passengerId = etxt_passenger_id.getText().toString();
                String info = etxt_addjob_extrainfo.getText().toString();
                String params = "PassengerId="+passengerId+"&DriverId="+driverID+"&PickLatLng="+lat_origin+","+lng_origin+"&DropLatLng="+lat_dest+","+lng_dest+"&PickAddress="+txt_pickaddr_pickup.getText().toString()+"&DropAddress="+txt_dropaddr_pickup.getText().toString()+"&VehicleType="+hm_holding_vehicletype_id.get(spinner_addjob_vehicletype.getSelectedItem().toString())+"&BookingType="+spinner_addjob_bookingtype.getSelectedItem().toString()+"&Passengers="+spinner_addjob_passengers.getSelectedItem().toString()+"&Bags="+spinner_addjob_bags.getSelectedItem().toString()+"&WheelChairs="+spinner_addjob_wheelchairs.getSelectedItem().toString()+"&Info="+info+"&DateTime="+txt_datetime_pickup.getText().toString()+"&EstimatedDistance="+txt_addjob_distance.getText().toString()+"&EstimatedTime="+txt_addjob_time.getText().toString()+"&Name="+etxt_addjob_passengername.getText().toString();
                Log.e("params",params);
                MakebookJobRequest();
//                new bookJob().execute(params);
            }
        });

        layout_datetime.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                Calendar mcurrentTime = Calendar.getInstance();
                int hour = mcurrentTime.get(Calendar.HOUR_OF_DAY);
                int minute = mcurrentTime.get(Calendar.MINUTE);
                int year = mcurrentTime.get(Calendar.YEAR);
                int month = mcurrentTime.get(Calendar.MONTH);
                int day = mcurrentTime.get(Calendar.DAY_OF_MONTH);
                timeDialog = new TimePickerDialog(AddJob.this, new TimePickerDialog.OnTimeSetListener() {
                    @Override
                    public void onTimeSet(TimePicker timePicker, int selectedHour, int selectedMinute) {
                        dateToBeSent += " "+selectedHour+":"+selectedMinute;
                        txt_datetime_pickup.setText(dateToBeSent);
                    }
                },hour,minute,false);
                timeDialog.setTitle("Select Time");
                timeDialog.show();

                dateDialog = new DatePickerDialog(AddJob.this, new DatePickerDialog.OnDateSetListener() {
                    @Override
                    public void onDateSet(DatePicker datePicker, int year, int month, int day) {
                        dateToBeSent = ""+(month+1)+"/"+day+"/"+year;
                    }
                },year,month,day);
                dateDialog.show();
            }
        });
    }

    private void setUpbookingTypeSpinner() {
        ArrayAdapter<String> adapter_bookingtype = new ArrayAdapter<String>(getApplicationContext(),R.layout.row_spinner,R.id.txt_spinner_bookingtype_addjob,spinner_data_bookingtype);
        spinner_addjob_bookingtype.setAdapter(adapter_bookingtype);

        ArrayAdapter<String> adapter = new ArrayAdapter<String>(getApplicationContext(),R.layout.row_spinner,R.id.txt_spinner_bookingtype_addjob,spinner_data);
        spinner_addjob_passengers.setAdapter(adapter);
        spinner_addjob_bags.setAdapter(adapter);
        spinner_addjob_wheelchairs.setAdapter(adapter);
    }

    private void toolbarSetup() {
        setSupportActionBar(toolbar_addjob);
        getSupportActionBar().setTitle("New Job");
    }

    private void widgets() {
        confirm = (Button)findViewById(R.id.confirmbooking) ;
        toolbar_addjob = (Toolbar) findViewById(R.id.toolbar_addjob);
        spinner_addjob_bookingtype = (Spinner) findViewById(R.id.spinner_addjob_bookingtype);
        spinner_addjob_passengers = (Spinner) findViewById(R.id.spinner_addjob_passengers);
        spinner_addjob_bags = (Spinner) findViewById(R.id.spinner_addjob_bags);
        spinner_addjob_wheelchairs = (Spinner)findViewById(R.id.spinner_addjob_wheelchairs);
        layout_addjob_pickaddress = (LinearLayout) findViewById(R.id.layout_addjob_pickaddress);
        layout_addjob_dropaddress = (LinearLayout) findViewById(R.id.layout_addjob_dropaddress);
        txt_pickaddr_pickup = (TextView) findViewById(R.id.txt_pickaddr_pickup);
        txt_dropaddr_pickup = (TextView) findViewById(R.id.txt_dropaddr_pickup);
        spinner_addjob_vehicletype = (Spinner) findViewById(R.id.spinner_addjob_vehicletype);
        layout_datetime = (LinearLayout) findViewById(R.id.layout_datetime);
        txt_datetime_pickup = (TextView) findViewById(R.id.txt_datetime_pickup);
        txt_addjob_time = (TextView) findViewById(R.id.txt_addjob_time);
        txt_addjob_distance = (TextView) findViewById(R.id.txt_addjob_distance);
        etxt_addjob_passengername = (EditText) findViewById(R.id.etxt_addjob_passengername);
        etxt_addjob_extrainfo = (EditText) findViewById(R.id.etxt_addjob_extrainfo);
        etxt_passenger_id = (EditText) findViewById(R.id.etxt_passenger_id);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        MenuInflater m = getMenuInflater();
        m.inflate(R.menu.menu_addjob,menu);
        return super.onCreateOptionsMenu(menu);
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        switch (id){
            case R.id.done:
                if (etxt_passenger_id.getText().toString().equalsIgnoreCase("")){
                    Toast.makeText(this, "Enter Passenger ID", Toast.LENGTH_SHORT).show();
                }
                passengerId = etxt_passenger_id.getText().toString();
                String info = etxt_addjob_extrainfo.getText().toString();
                String params = "PassengerId="+passengerId+"&DriverId="+driverID+"&PickLatLng="+lat_origin+","+lng_origin+"&DropLatLng="+lat_dest+","+lng_dest+"&PickAddress="+txt_pickaddr_pickup.getText().toString()+"&DropAddress="+txt_dropaddr_pickup.getText().toString()+"&VehicleType="+hm_holding_vehicletype_id.get(spinner_addjob_vehicletype.getSelectedItem().toString())+"&BookingType="+spinner_addjob_bookingtype.getSelectedItem().toString()+"&Passengers="+spinner_addjob_passengers.getSelectedItem().toString()+"&Bags="+spinner_addjob_bags.getSelectedItem().toString()+"&WheelChairs="+spinner_addjob_wheelchairs.getSelectedItem().toString()+"&Info="+info+"&DateTime="+txt_datetime_pickup.getText().toString()+"&EstimatedDistance="+txt_addjob_distance.getText().toString()+"&EstimatedTime="+txt_addjob_time.getText().toString()+"&Name="+etxt_addjob_passengername.getText().toString();
                Log.e("params",params);
                MakebookJobRequest();
//                new bookJob().execute(params);
                break;
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 010 && resultCode == RESULT_OK){
            try {
                nameReceived = "" + data.getExtras().get("loc_name");
                locReceived = (LatLng) data.getExtras().get("loc_latlng");
            }catch (Exception e){
                Toast.makeText(this, "data error"+nameReceived.toString(), Toast.LENGTH_SHORT).show();
            }
            lat_origin = locReceived.latitude;
            lng_origin = locReceived.longitude;
            txt_pickaddr_pickup.setText(nameReceived);
        }
        else if (requestCode == 011 && resultCode == RESULT_OK){
            nameReceived = ""+data.getExtras().get("loc_name");
            locReceived = (LatLng) data.getExtras().get("loc_latlng");
            lat_dest = locReceived.latitude;
            lng_dest = locReceived.longitude;
            txt_dropaddr_pickup.setText(nameReceived);
            new estimated().execute();
        }
    }
   StringRequest postRequest;
    void MakeloadVehicleTypeRequest() {
        Log.d("httpsSSL", "called");
        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,

                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("httpsSSLresponse", response.toString());

                        try {
                            JSONObject obj = new JSONObject(response);
                            JSONArray arr_vehicleTypes = obj.getJSONArray("VehilcesTypes");
                            spinner_data_vehicle_type = new String[arr_vehicleTypes.length()];
                            for (int i = 0; i < arr_vehicleTypes.length(); i++){
                                JSONObject obj_inner = arr_vehicleTypes.getJSONObject(i);
                                int id = obj_inner.getInt("Id");
                                String vehicleName = obj_inner.getString("VehicleName");
                                hm_holding_vehicletype_id.put(vehicleName,id);
                                spinner_data_vehicle_type[i] = vehicleName;
                            }
                            ArrayAdapter<String> adapter = new ArrayAdapter<String>(getApplicationContext(),R.layout.row_spinner,R.id.txt_spinner_bookingtype_addjob,spinner_data_vehicle_type);
                            spinner_addjob_vehicletype.setAdapter(adapter);
                        }
                        catch (Exception ex){
                            Log.e("kuni",ex.getMessage());
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
                pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
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
                   // String params = "CompanyId="+companyId;
                    params.put("Parms", "CompanyId,,"+companyId);
                    params.put("Action", "FnVehicleTypes");
                    params.put("UserKey", appcontext.getInstance().passforlink);
                    params.put("Token", appcontext.getInstance().token);
                    Log.e("httpsparmsare",params.toString());

                }catch (Exception e){
                    e.printStackTrace();
                }

                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","val1ueoF2ndParam");
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
//        Volley.newRequestQueue(this).add(postRequest);
    }

    //unused
    public class loadVehicleType extends AsyncTask<Void,Void,String>{
        String data="";
        ProgressDialog pd;
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(AddJob.this,"Cabs Wiki","Loading Form",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);
                String params = "CompanyId="+companyId;
                //Log.e("params",params);
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
                Log.e("360taxi",ex.getMessage());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            pd.dismiss();
            try {
                JSONObject obj = new JSONObject(s);
                JSONArray arr_vehicleTypes = obj.getJSONArray("VehilcesTypes");
                spinner_data_vehicle_type = new String[arr_vehicleTypes.length()];
                for (int i = 0; i < arr_vehicleTypes.length(); i++){
                    JSONObject obj_inner = arr_vehicleTypes.getJSONObject(i);
                    int id = obj_inner.getInt("Id");
                    String vehicleName = obj_inner.getString("VehicleName");
                    hm_holding_vehicletype_id.put(vehicleName,id);
                    spinner_data_vehicle_type[i] = vehicleName;
                }
                ArrayAdapter<String> adapter = new ArrayAdapter<String>(getApplicationContext(),R.layout.row_spinner,R.id.txt_spinner_bookingtype_addjob,spinner_data_vehicle_type);
                spinner_addjob_vehicletype.setAdapter(adapter);
            }
            catch (Exception ex){
                Log.e("kuni",ex.getMessage());
            }
        }
    }


    public class estimated extends AsyncTask<Void,Void,String>{
        ProgressDialog pd;
        String data = "";
        StringBuilder strBuilder;
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(AddJob.this,"CabsWiki","Estimating",false,false);
            strBuilder = new StringBuilder();
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&origins="+lat_origin+","+lng_origin+"&destinations="+lat_dest+","+lng_dest+"&key=AIzaSyB1NxMgKqwzTfikQXRQ-m06cJIqZWVSXeY");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                while ((data = reader.readLine())!= null){
                    strBuilder.append(data);
                }
                Log.e("waseem",strBuilder.toString());
            }
            catch (Exception ex){

            }
            return strBuilder.toString();
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            pd.dismiss();
            try{
                JSONObject obj = new JSONObject(s);
                JSONArray arr_rows = obj.getJSONArray("rows");
                JSONObject obj_inner = arr_rows.getJSONObject(0);
                JSONArray elements = obj_inner.getJSONArray("elements");
                JSONObject obj_inner_elements = elements.getJSONObject(0);
                JSONObject distance = obj_inner_elements.getJSONObject("distance");
                JSONObject duration = obj_inner_elements.getJSONObject("duration");
                String txt_distance = distance.getString("text");
                String txt_duration = duration.getString("text");
                txt_addjob_distance.setText(txt_distance);
                txt_addjob_time.setText(txt_duration);
            }
            catch (Exception ex){

            }
        }
    }



    void MakebookJobRequest() {
        Log.d("httpsSSL", "called");
        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,

                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("httpsSSLresponse", response.toString());
                        try {
                            JSONObject obj = new JSONObject(response);
                            String BookingMessage = obj.getString("BookingMessage");
                            Toast.makeText(AddJob.this, BookingMessage, Toast.LENGTH_SHORT).show();
                            AddJob.this.finish();
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
                pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
                try {
                    passengerId = etxt_passenger_id.getText().toString();
                    String info = etxt_addjob_extrainfo.getText().toString();

                    String param = "PassengerId,,"+passengerId+"&&DriverId,,"+appcontext.getInstance().DriverId+"&&PickLatLng,,"+lat_origin+","+lng_origin+"&&DropLatLng,,"+lat_dest+","+lng_dest+"&&PickAddress,,"+txt_pickaddr_pickup.getText().toString()+"&&DropAddress,,"+txt_dropaddr_pickup.getText().toString()+"&&VehicleType,,"+hm_holding_vehicletype_id.get(spinner_addjob_vehicletype.getSelectedItem().toString())+"&&BookingType,,"+spinner_addjob_bookingtype.getSelectedItem().toString()+"&&Passengers,,"+spinner_addjob_passengers.getSelectedItem().toString()+"&&Bags,,"+spinner_addjob_bags.getSelectedItem().toString()+"&&WheelChairs,,"+spinner_addjob_wheelchairs.getSelectedItem().toString()+"&&Info,,"+info+"&&DateTime,,"+txt_datetime_pickup.getText().toString()+"&&EstimatedDistance,,"+txt_addjob_distance.getText().toString()+"&&EstimatedTime,,"+txt_addjob_time.getText().toString()+"&&Name,,"+etxt_addjob_passengername.getText().toString();

                    params.put("Parms", param);
                    params.put("Action", "FnMeterJobAdded");
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
//        Volley.newRequestQueue(this).add(postRequest);
    }
    //unused
    public class bookJob extends AsyncTask<String,Void,String>{
        ProgressDialog pd;
        String data = "";
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(AddJob.this,"CabsWiki","Adding new job",false,false);
        }

        @Override
        protected String doInBackground(String... strings) {
            try {
                URL url = new URL(appcontext.getInstance().link);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setDoOutput(true);
                conn.setRequestMethod("POST");
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(strings[0]);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
            }
            catch (Exception ex){
                Log.e("error","bookJob"+ex.getMessage());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            pd.dismiss();
            Log.e("majid",s);
            try {
                JSONObject obj = new JSONObject(s);
                String BookingMessage = obj.getString("BookingMessage");
                Toast.makeText(AddJob.this, BookingMessage, Toast.LENGTH_SHORT).show();
                AddJob.this.finish();
            }
            catch (Exception ex){

            }
        }
    }
}
