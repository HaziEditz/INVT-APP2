package com.khybertech.taxi360driver.StartShift;

import android.app.ProgressDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.preference.PreferenceManager;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.support.v7.widget.Toolbar;
import android.util.Log;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.google.firebase.auth.FirebaseAuth;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.R;
import com.google.android.gms.maps.model.LatLng;
//import com.onesignal.OneSignal;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class StartShift extends AppCompatActivity {

    TextView txt_startShift_date,txt_startShift_time;
    SecurePreferences pref;
    String playerid = "";
    SecurePreferences edit;
    Date completeDateTime ;
    String dateOnly, TimeOnly;
    Spinner spinner_start_shift;
    String url_company_vehicles = "";// "http://webservices.360taxitaxi.co.nz/api/DriverApp/DriverCompanyVehicles";
    String url_select_vehicle = "";// "http://webservices.360taxitaxi.co.nz/api/DriverApp/AssignDriverVehicle";
    HashMap<String,Integer> hm_holding_vehicleIds = new HashMap<>();
    HashMap<String,String> hm_holding_vehicleNames = new HashMap<>();
    String[] vehicleNames;
    Button btn_startshift_selectVehicle;
    String companyId, vehicleId, driverId;
    Toolbar toolbar_signin;
    ImageView dropdownimage ;
    StringRequest postRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_start_shift);
//        pref = PreferenceManager.getDefaultSharedPreferences(StartShift.this);
//        edit = pref.edit();
        pref = appcontext.getInstance().pref;
        edit = appcontext.getInstance().pref;
        url_company_vehicles = appcontext.getInstance().link;  //"http://webservices.360taxitaxi.co.nz/api/DriverApp/DriverCompanyVehicles";
        url_select_vehicle = appcontext.getInstance().link;//"http://webservices.360taxitaxi.co.nz/api/DriverApp/AssignDriverVehicle";
//        OneSignal.idsAvailable(new OneSignal.IdsAvailableHandler() {
//            @Override
//            public void idsAvailable(String userId, String registrationId) {
//                playerid = userId;
//            }
//
//        });

        companyId = pref.getString("company_id");
        driverId = ""+appcontext.getInstance().DriverId;
        widgets();
        Calendar c = Calendar.getInstance();
//

        completeDateTime = c.getTime();
//        toolbar_signin.setTitle("Start Shift");
//        toolbar_signin.setNavigationIcon(R.drawable.back_icon);
//        toolbar_signin.setNavigationOnClickListener(new View.OnClickListener() {
//            @Override
//            public void onClick(View view) {
//              //  onBackPressed();
//                Intent intent = new Intent();
//                intent.putExtra("shift", "2");
//                setResult(RESULT_OK , intent);
//                finish();
//            }
//        });

        SimpleDateFormat toFullDate = new SimpleDateFormat("dd-MMM-yyyy HH:mm:ss");
        try {
            SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy HH:mm:ss", Locale.ENGLISH);
            String currentDateTime = format.format(c.getTime());
            Date fullDate = toFullDate.parse(currentDateTime);
            SimpleDateFormat dateOnlyDate = new SimpleDateFormat("dd-MMM-yyyy");
            SimpleDateFormat timeOnlyTime = new SimpleDateFormat("HH:mm:ss");
            dateOnly = dateOnlyDate.format(fullDate);
            TimeOnly = timeOnlyTime.format(fullDate);
            txt_startShift_date.setText(dateOnly);
            txt_startShift_time.setText(TimeOnly);
        } catch (Exception e) {
            Log.e("error",e.getMessage());
        }

        MakePostRequest();
        //new getVehicles().execute();

        dropdownimage.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                spinner_start_shift.performClick();
            }
        });

        spinner_start_shift.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> adapterView, View view, int i, long l) {
                String SelectedVeh = spinner_start_shift.getSelectedItem().toString();
//                TextView vh_selected_text = (TextView) findViewById(R.id.selected_vh_text);
//                vh_selected_text.setText("SELECTED VEHICLE: "+SelectedVeh);
            }

            @Override
            public void onNothingSelected(AdapterView<?> adapterView) {

            }
        });

        btn_startshift_selectVehicle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                   try {
                       String SelectedVeh = spinner_start_shift.getSelectedItem().toString();
                       vehicleId = String.valueOf(hm_holding_vehicleIds.get(SelectedVeh));
                       Log.e("vehicleId", vehicleId);

                       vehicleselectionRequest();
                       //new selectVehicle().execute(vehicleId);
                   }catch (Exception e){
                       Toast.makeText(StartShift.this, "Vehicale not selected", Toast.LENGTH_SHORT).show();
                   }
            }
        });
    }

    private void widgets() {
        dropdownimage = (ImageView)findViewById(R.id.imagedropdown);
        txt_startShift_date = (TextView) findViewById(R.id.txt_startShift_date);
        txt_startShift_time = (TextView) findViewById(R.id.txt_startShift_time);
        spinner_start_shift = (Spinner) findViewById(R.id.spinner_start_shift);
        btn_startshift_selectVehicle = (Button) findViewById(R.id.btn_startshift_selectVehicle);
        toolbar_signin = (Toolbar) findViewById(R.id.toolbar_signin);
    }


    void MakePostRequest() {

        postRequest = new StringRequest(Request.Method.POST, url_company_vehicles,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("dataresp",response.toString());
                        // pd.dismiss();
                        setdata(response.toString());

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        Toast.makeText(StartShift.this, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                params.put("CompanyId", pref.getString("company_id","null") );

                params.put("Parms", "CompanyId,,"+pref.getString("company_id")
                        +"&&DriverId,,"+appcontext.getInstance().DriverId);
                Log.e("paramsshift","CompanyId,,"+pref.getString("company_id")
                        +"&&DriverId,,"+appcontext.getInstance().DriverId);
                params.put("Action", "DriverCompanyVehicles");
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
//        Volley.newRequestQueue(StartShift.this).add(postRequest);
    }

    void setdata(String s) {
        Log.e("maddy",s);
        try{
            JSONArray vehicle_arrays = new JSONArray(s);
            vehicleNames = new String[vehicle_arrays.length()];
            for (int i = 0; i < vehicle_arrays.length(); i++){
                JSONObject obj = vehicle_arrays.getJSONObject(i);
                int vehicleId = obj.getInt("Id");
                String vehicleNo = obj.getString("VehicleNo");
                hm_holding_vehicleIds.put(vehicleNo,vehicleId);
                hm_holding_vehicleNames.put(vehicleId+"",vehicleNo);
                vehicleNames[i] = vehicleNo;
            }
            ArrayAdapter<String> adapter = new ArrayAdapter<String>(StartShift.this,R.layout.row_spinner,R.id.txt_spinner_bookingtype_addjob,vehicleNames);
            spinner_start_shift.setAdapter(adapter);
        }
        catch (Exception ex){

        }
    }


    public class getVehicles extends AsyncTask<String,Void,String>{
        ProgressDialog pd;
        String data = "";

        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(StartShift.this,"CabsWiki","Loading your vehicles",false,false);
        }

        @Override
        protected String doInBackground(String... strings) {
            try {
                URL url = new URL(url_company_vehicles);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                String params = "CompanyId="+pref.getString("company_id");
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
            pd.dismiss();
            Log.e("maddy",s);
            try{
                JSONArray vehicle_arrays = new JSONArray(s);
                vehicleNames = new String[vehicle_arrays.length()];
                for (int i = 0; i < vehicle_arrays.length(); i++){
                    JSONObject obj = vehicle_arrays.getJSONObject(i);
                    int vehicleId = obj.getInt("Id");
                    String vehicleNo = obj.getString("VehicleNo");
                    hm_holding_vehicleIds.put(vehicleNo,vehicleId);
                    vehicleNames[i] = vehicleNo;
                }
                ArrayAdapter<String> adapter = new ArrayAdapter<String>(StartShift.this,R.layout.row_spinner,R.id.txt_spinner_bookingtype_addjob,vehicleNames);
                spinner_start_shift.setAdapter(adapter);
            }
            catch (Exception ex){

            }
        }
    }

    void vehicleselectionRequest() {

        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("dataresp",response.toString());
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")){
                            vehicleselectionRequest();
                        }else {


                            setdatavehicle(response.toString());
                        }

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        Toast.makeText(StartShift.this, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
                try {
                    SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy HH:mm:ss", Locale.ENGLISH);
                    Calendar c = Calendar.getInstance();
                    String date = format.format(c.getTime());
                    Date toFullDate = format.parse(date);
                    SimpleDateFormat dateOnlyDate = new SimpleDateFormat("MM/dd/yyyy");
//                    SimpleDateFormat timeOnlyTime = new SimpleDateFormat("KK:mm:ss");
                    SimpleDateFormat timeOnlyTime = new SimpleDateFormat("HH:mm:ss");
                    String loginDate = dateOnlyDate.format(toFullDate);
                    String loginTime = timeOnlyTime.format(toFullDate).replace(".", "");

                    String param = "PlayerId,,"+ FirebaseAuth.getInstance().getCurrentUser().getUid()+"&&DriverId,," + driverId + "&&VehicleId,," + vehicleId+"&&LogInDate,,"+loginDate+"&&LogInTime,,"+loginTime;

                    Log.e("paramsshift",param+"");
                    params.put("Parms", param);
                    params.put("Action", "AssignDriverVehicle");
                    params.put("UserKey", appcontext.getInstance().passforlink);
                    params.put("Token", appcontext.getInstance().token);
                }catch (Exception e){

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
//        Volley.newRequestQueue(StartShift.this).add(postRequest);
    }

    void setdatavehicle(String s) {

        try {
            JSONArray jsonArray = new JSONArray(s);
            s = jsonArray.getJSONObject(0).getString("Result");
            appcontext.getInstance().myCarType = jsonArray.getJSONObject(0).getString("VehichleType");
        } catch (JSONException e) {
            e.printStackTrace();
        }
        Toast.makeText(StartShift.this, s + " Assignment", Toast.LENGTH_SHORT).show();
        if(s.toString().equalsIgnoreCase("Selected Vehicle Successfully Assigned")){
            try {
                Log.e("vehicleresp",s);
                pref.put("SelectedVehicleid",vehicleId);
                pref.put("SelectedVehicleName",hm_holding_vehicleNames.get(vehicleId));

                Intent intent = new Intent();
                intent.putExtra("shift", "1");
                setResult(RESULT_OK , intent);
                finish();
//             final ProgressDialog  pd = ProgressDialog.show(this,"Taxi360taxi","Picking current location..",false,false);
//
//
//                LocationManager locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
//
//
//                LocationListener locationListener = new LocationListener() {
//                    @Override
//                    public void onLocationChanged(Location location) {
//
//
                        final LatLng sydney = new LatLng(appcontext.getInstance().realtimelocation.getLatitude(), appcontext.getInstance().realtimelocation.getLongitude());

                        final int speed = (int) ((appcontext.getInstance().realtimelocation.getSpeed() * 3600) / 1000);

                        Log.e("locationrec",sydney+"");

                MakeDriverVehicleLocationUpdaterequest(sydney);


//                        new AsyncTask<Void, Void, String>() {
//                            String data = "";
//                            String currentDateTimeloc = "";
//                            @Override
//                            protected void onPreExecute() {
//                                super.onPreExecute();
//                                Calendar c = Calendar.getInstance();
//                                SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
//                                currentDateTimeloc = format.format(c.getTime());
//                                driverId = ""+pref.getInt("user_id", 0);
//                            }
//
//                            @Override
//                            protected String doInBackground(Void... voids) {
//                                try {
//                                    URL url = new URL(getApplicationContext().getString(R.string.DriverVehicleLocationUpdate));//"http://webservices.cabs.wiki/api/DriverApp/DriverVehicleLocationUpdate");
//                                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
//                                    conn.setDoOutput(true);
//                                    conn.setRequestMethod("POST");
//                                    String params = "Lat=" + sydney.latitude + "&Lng=" + sydney.longitude + "&DriverId=" + driverId + "&VehicleSpeed=" + speed + "&UpdateDateTime=" + currentDateTimeloc +"&VehicleId="+vehicleId;
//                                    Log.e("locationupdatesparam", params);
//                                    OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
//                                    writer.write(params);
//                                    writer.flush();
//                                    BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
//                                    data = reader.readLine();
//                                } catch (Exception ex) {
//                                    Log.e("error", ex.getLocalizedMessage());
//                                }
//                                return data;
//                            }
//
//                            @Override
//                            protected void onPostExecute(String s) {
//                                super.onPostExecute(s);
//
//
//                            }
//                        }.execute();

//
//                    }
//
//                    @Override
//                    public void onStatusChanged(String provider, int status, Bundle extras) {
//
//                    }
//
//                    @Override
//                    public void onProviderEnabled(String provider) {
//
//                    }
//                    @Override
//                    public void onProviderDisabled(String provider) {
//
//                    }
//                };
//
//                if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
//                    // TODO: Consider calling
//                    //    ActivityCompat#requestPermissions
//                    // here to request the missing permissions, and then overriding
//                    //   public void onRequestPermissionsResult(int requestCode, String[] permissions,
//                    //                                          int[] grantResults)
//                    // to handle the case where the user grants the permission. See the documentation
//                    // for ActivityCompat#requestPermissions for more details.
//                    return;
//                }
//                Criteria criteria = new Criteria();
//                criteria.setAccuracy(Criteria.ACCURACY_FINE);
//                criteria.setPowerRequirement(Criteria.POWER_HIGH);
//                locationManager.requestSingleUpdate(criteria, locationListener , null);

            }catch (Exception e){

                Log.e("location",e.getMessage());
                e.printStackTrace();
            }

        }

    }


    void MakeDriverVehicleLocationUpdaterequest(final LatLng sydney) {
        Log.d("httpsSSL", "called");
        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,

                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("httpsSSLresponse", response.toString());

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
                    Calendar c = Calendar.getInstance();
                    SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
                    String currentDateTimeloc = format.format(c.getTime());
                    final LatLng sydney = new LatLng(appcontext.getInstance().realtimelocation.getLatitude(), appcontext.getInstance().realtimelocation.getLongitude());

                    final int speed = (int) ((appcontext.getInstance().realtimelocation.getSpeed() * 3600) / 1000);

                    String param = "Lat,," + sydney.latitude + "&&Lng,," + sydney.longitude + "" +
                            "&&DriverId,," + driverId + "&&VehicleSpeed,," + speed + "" +
                            "&&UpdateDateTime,," + currentDateTimeloc +"&&VehicleId,,"+vehicleId;

                    params.put("Parms", param);
                    params.put("Action", "DriverVehicleLocationUpdate");
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
//        Volley.newRequestQueue(StartShift.this).add(postRequest);
    }


    //not used any more.. it was previously used
    public class selectVehicle extends AsyncTask<String,Void,String>{
        ProgressDialog pd;
        String data = "";

        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(StartShift.this,"CabsWiki","Selecting Vehicle For You",false,false);
        }

        @Override
        protected String doInBackground(String... strings) {
            try {
                URL url = new URL(appcontext.getInstance().link);
                String params = "DriverId="+driverId+"&VehicleId="+vehicleId;
                Log.e("params1",params+""+vehicleId);
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
                ex.printStackTrace();
                   Log.d("recievingdataerror",ex.getMessage().toString());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);

            pd.dismiss();
            Toast.makeText(StartShift.this, s + " Assignment", Toast.LENGTH_SHORT).show();
            if(s.toString().equalsIgnoreCase("Selected Vehicle Successfully Assigned")){
                Log.d("shift",s.toString());
                Intent intent = new Intent();
                intent.putExtra("shift", "1");
                setResult(RESULT_OK , intent);
                finish();
            }

        }
    }
}
