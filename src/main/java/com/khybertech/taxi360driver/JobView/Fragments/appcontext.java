package com.khybertech.taxi360driver.JobView.Fragments;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.location.Location;
import android.preference.PreferenceManager;
import android.text.InputType;
import android.util.Log;
import android.widget.EditText;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.RequestQueue;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.MainActivity.Taximetterservice;
import com.google.firebase.auth.FirebaseAuth;
import com.google.android.gms.maps.model.LatLng;
import com.khybertech.taxi360driver.R;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Timer;

/**
 * Created by Me on 5/11/2017.
 */

public class appcontext {

    private static final appcontext ourInstance = new appcontext();

    public static appcontext getInstance() {
        return ourInstance;
    }

    public FirebaseAuth mAuthfirebase = null;

    public ArrayList<LatLng> pathformetter ;
    public double utilmetterdistance = 0.00;
    public double maxSpeed = 0.0;
    public ArrayList<LatLng> shiftlocationslist ;


    public Location realtimelocation = null;
    public Location prevRealtimeloccation = null;
    public Location metterlastCalculatedPoint = null;
    public Location lastupdatedlocation = null;

    public String myCarType = "car";


    public RequestQueue mRequestQueue;
    public String JobArrivedDetails = "[]";
    public String BasicAmount =  "0";
    public String MaxDiscount =  "0";
    public String Percentage =  "0";
    public String promoType =  "value";

    public boolean isTarrifSelectionVisible = true;
    public boolean isJobfixedRat = false;
    public String fixedprice = "0";


    public String currentzone = "";
    public Context con;
    public HashMap<String,String> Networkdata = new HashMap<>();
    public HashMap<String,String> currentdata = new HashMap<>();
    public HashMap<String,String> queuedata = new HashMap<>();
    public HashMap<String,String> offereddata = new HashMap<>();
    public HashMap<String,String> completeddata = new HashMap<>();
    public HashMap<String,String> chatdata = new HashMap<>();



    public String backgroundstatus = "Available";
    public  String backgroundstatuscolor = "#ff495263";
    public String backgroundavailablecolor = "#88a903";
    public String backgroundbusycolor = "#ef9e11";
    public String backgroundawaycolor = "#e8692b";



    public String TarrifJSondata = "[]";
    public String Zonesjsondata = "[]";
    public int mettercalled =0;
    public String timeclock = "0";
    public String token = "";


    public String playerID = "0";



    public String DriverId="";

    public String droplatlng = "";
    public String droplocation = "";
    public String activebookingid = "0";
    public String CompanyID = "0";
    public String Drivertype = "";
    public String startingFare = "0";
    public String fare = "0.00";

    public Boolean connected = false;


    public Float pocket = 0f;
    public String DistanceCovered = "0.0";
    public String waitingtime ="0";
    public int waitingminutes =0;

    //for firebase node jobs  which is used by dispatcher to end the job in case if mobile can't end it
    public String pickup ="";
    public String dropoff ="";


    public String Tarrifid = "0";
    public String TarrifName = "Normal";
    public double DistanceRate = 0;
    public double WaitingRate = 0;
    public double waitingseconds = 0;
    public double totalseconds = 0;
    public String PromoId = "0";
    public String smscode = "";

    public Boolean isnotificationwindowsOpeneed = false;

    public String JobArrivedDeviceUid = "null";
    public String JobArrivedDeviceType = "null";

    public boolean mIsVehicleOnWait = false;
    public Intent taximetterserviceintentalways;



    public int lastsnap = 0;

    public Location oldloc;

    public Timer t;
    public Taximetterservice taximetterservice = null;
    public Taximetter taximetterfragment = null;

    public String metterstatus = "stopped";
    public Boolean metterPaused = false;


    public Current currentobj = new Current();
    public  Map<String, String> paramsforsms;
    public String number = "";

    public  String passforlink="";
    public  String link="";

    public String collectedsensordata ;
    public SecurePreferences pref;
    public int busyclicked = 0;

    public Activity queudetailsactivity;
    public Activity Offerdetailsactivity;


    public void currentjob(){
        final DatabaseReference databaseReference =  FirebaseDatabase.getInstance().getReference()
                .child("Passengerjobs")
                .child(JobArrivedDeviceUid);
        databaseReference.addValueEventListener(new ValueEventListener() {
            @Override
            public void onDataChange(DataSnapshot dataSnapshot) {
                HashMap<String, Object> data = new HashMap<>();
                for (DataSnapshot childSnapshot : dataSnapshot.getChildren()) {
                    data.put(childSnapshot.getKey(), childSnapshot.getValue());
//                    Log.e("jobdata",childSnapshot.getValue().toString());
                }
                try {

                    if (data.get("status").toString().equalsIgnoreCase("Passengercancel")) {
                        try {
                            databaseReference.removeEventListener(this);
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                        appcontext.getInstance().backgroundstatus = "Available";
                        appcontext.getInstance().ChangestatusRequest();
                        queudetailsactivity.finish();
                        Toast.makeText(con, "Job Cancelled by Passenger\n Thank you!", Toast.LENGTH_LONG).show();
                    }

                }catch (Exception e){
                    e.printStackTrace();
                }
            }

            @Override
            public void onCancelled(DatabaseError databaseError) {

            }
        });

    }


    public void ChangestatusRequest() {

        pref = pref;
        StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data332",response.toString());
                        // pd.dismiss();
                        setdatastatus(response);


                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
//                        Toast.makeText(getContext(), "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                params.put("DriverId", driverId+"");
//                params.put("Status", "FnDriverStatusUpdate");
                params.put("Parms", "ZoneId,,"+appcontext.getInstance().currentzone+"&&VehicleId,,"+pref.getString("SelectedVehicleid")+"&&CompanyId,,"+pref.getString("company_id")+"&&DriverId,,"+appcontext.getInstance().DriverId+"&&Status,,"+appcontext.getInstance().backgroundstatus);
                params.put("Action", "FnDriverStatusUpdate");
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
//        Volley.newRequestQueue(getContext()).add(postrequest);
    }

    public void setdatastatus(String s) {
        // pd.dismiss();
        try {
//            Toast.makeText(getActivity(), new JSONArray(s).getJSONObject(0).getString("Result"), Toast.LENGTH_SHORT).show();

//            if(status.equalsIgnoreCase("busy")) {
//                appcontext.getInstance().backgroundstatus = "busy";
//            } else if(status.equalsIgnoreCase("away")){
//                appcontext.getInstance().backgroundstatus = "Away";
//                 }else if(status.equalsIgnoreCase("available")){
//                appcontext.getInstance().backgroundstatus = "Available";
//                  }
        }catch (Exception e){
            e.printStackTrace();
        }
    }

  public   void MakesmsRequest(String url) {

       StringRequest postRequest = new StringRequest(Request.Method.POST, url,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data32",response.toString());
                        appcontext.getInstance().number = "";
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")){

                            Log.e("tarrifdatarequest","got an error as response");
                        }else {

                        }
                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //  pd.dismiss();
                        Toast.makeText(appcontext.getInstance().con, "Network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {

                if(appcontext.getInstance().number.length()!=12||appcontext.getInstance().number.substring(0,1).equalsIgnoreCase("0")){
                    if(appcontext.getInstance().number.substring(0,1).equalsIgnoreCase("+")){
                        appcontext.getInstance().number = "" + appcontext.getInstance().number.substring(1, appcontext.getInstance().number.length());
                    }else {
                        appcontext.getInstance().number = "92" + appcontext.getInstance().number.substring(1, appcontext.getInstance().number.length());
                    }
                }
                paramsforsms.put("Number",appcontext.getInstance().number);

                Log.e("number",appcontext.getInstance().number);


                return paramsforsms;
            }
        };
       postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
               DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
               DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(getApplicationContext()).add(postRequest);
    }



    public void initapp(){
        FirebaseDatabase.getInstance().getReference()
                .child("links")
                .addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override
                    public void onDataChange(DataSnapshot dataSnapshot) {
                        HashMap<String, Object> data = new HashMap<>();
                        for (DataSnapshot childSnapshot : dataSnapshot.getChildren()) {
                            data.put(childSnapshot.getKey(), childSnapshot.getValue());
                        }
                        appcontext.getInstance().passforlink = data.get("passforlink").toString();
                        //production
                        appcontext.getInstance().link = data.get("serviceon").toString();
                        //testing
//                    Model.getInstance().link = data.get("serviceontesting").toString();

                        Log.e("linkss",appcontext.getInstance().link);
                    }

                    @Override
                    public void onCancelled(DatabaseError databaseError) {

                    }
                });
    }

    private appcontext() {
    }
}
