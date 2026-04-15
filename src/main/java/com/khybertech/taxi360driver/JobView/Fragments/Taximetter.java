package com.khybertech.taxi360driver.JobView.Fragments;

import android.app.AlertDialog;
import android.app.Dialog;
import android.app.ProgressDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.CountDownTimer;
import android.os.Handler;
import android.preference.PreferenceManager;
import android.support.design.widget.FloatingActionButton;
import android.support.v4.app.Fragment;
import android.text.InputType;
import android.text.TextUtils;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.SimpleAdapter;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.google.firebase.FirebaseException;
import com.google.firebase.FirebaseTooManyRequestsException;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException;
import com.google.firebase.auth.PhoneAuthCredential;
import com.google.firebase.auth.PhoneAuthProvider;
import com.google.firebase.database.FirebaseDatabase;
import com.khybertech.taxi360driver.JobView.CurrentJobDetail;
import com.khybertech.taxi360driver.JobView.JobView;
import com.khybertech.taxi360driver.JobView.QueueJobDetail;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.Maps.MapsActivityJobLocation;
import com.khybertech.taxi360driver.R;

import org.joda.time.DateTime;
import org.joda.time.DateTimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.net.UnknownHostException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;


import java.util.Map;
import java.util.Random;
import java.util.Timer;
import java.util.TimerTask;

import static android.app.Activity.RESULT_OK;

/**
 * A simple {@link Fragment} subclass.
 */
public class Taximetter extends Fragment {

    String url_current = "";//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnDriverCurrentJobs";
    Context con;
    int startcheck = 0;
    int completecheck = 0;
    SecurePreferences pref;
    SimpleAdapter adapter_list_current;
    ListView lv_fragment_current;
    List<HashMap<String, Object>> ls;
    ArrayList<HashMap<String, String>> HashtarrifIdandName,HashZonesIdandName, HashZonesLatLng;
    ArrayList<String> listtarrifdata,listZonesdata;
    String ZoneId,ZoneName, Zonelatlng;
    Location locationpick;
    String status;
    int driverId;
    public Button Button_starttime, Button_stoptime, Button_cancel, Button_pausetime, txt_tarif;
    Button extramoney;
    FloatingActionButton btn_addjob;
    StringRequest postRequest;
    StringRequest changestatusrequest;
    TextView txt_estimated_time,  txt_distance;

    String numb;
    private String statusparams;
    private String method;


    public Taximetter() {
        // Required empty public constructor
    }
    ProgressDialog pd;
    Timer T, wT;
    Calendar c;
    SimpleDateFormat format;
    String currentDateTime = "";
    int countminutes = 1;
    int countTime = 0;
    double rate = Double.parseDouble(appcontext.getInstance().fare);

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container,
                             Bundle savedInstanceState) {
        View v = inflater.inflate(R.layout.fragment_taximetter, container, false);
        Button_starttime = (Button) v.findViewById(R.id.starttime);
        Button_cancel = (Button) v.findViewById(R.id.cancelbtn);
//        Button_stoptime = (Button) v.findViewById(R.id.stoptime);
        Button_pausetime = (Button) v.findViewById(R.id.pausetime);
//        extramoney = (Button) v.findViewById(R.id.extramoney);
        txt_estimated_time = (TextView) v.findViewById(R.id.timeclock);

        txt_distance = (TextView) v.findViewById(R.id.distance);
//        LinearLayout distancelinearlayout = (LinearLayout) v.findViewById(R.id.DistanceLinearlayout);

//        distancelinearlayout.setOnClickListener(new View.OnClickListener() {
//            @Override
//            public void onClick(View view) {
//                if(Button_starttime.getText().toString().equalsIgnoreCase("COMPLETE")) {
//                    Intent i = new Intent(getContext(), MapsActivityJobLocation.class);
//                    i.putExtra("pick_latlong", pref.getString("activejobpicklatlng",""));
//                    i.putExtra("drop_latlong", pref.getString("activejobdroplatlng",""));
//                    i.putExtra("BookingId",appcontext.getInstance().activebookingid);
//                    startActivityForResult(i, 101);
//                }else {
//                    Toast.makeText(getContext(), "You have no active job", Toast.LENGTH_SHORT).show();
//                }
//            }
//        });

//        pref = PreferenceManager.getDefaultSharedPreferences(getContext());
           pref = appcontext.getInstance().pref;
        txt_tarif = (Button) v.findViewById(R.id.txt_tarrif);
        txt_tarif.setText(appcontext.getInstance().TarrifName);

        if(!appcontext.getInstance().isTarrifSelectionVisible)
           txt_tarif.setVisibility(View.INVISIBLE);

        if(appcontext.getInstance().Zonesjsondata.equalsIgnoreCase("[]")&& appcontext.getInstance().busyclicked == 0){
            pd = ProgressDialog.show(getContext(),"Taxi360taxi","Fetching Data...",false,false);
            MakeZonesRequest();
        }

        if (appcontext.getInstance().metterstatus.equalsIgnoreCase("started")) {
            //   appcontext.getInstance().taximetterservice.starttime();
            Button_starttime.setText("COMPLETE");
            //   appcontext.getInstance().metterstatus = "stopped";
            //  Button_starttime.performClick();
        }


//        extramoney.setOnClickListener(new View.OnClickListener() {
//            @Override
//            public void onClick(View view) {
//                startActivityForResult(new Intent(getActivity(), add_extra_money.class), 007);
//            }
//        });


        txt_tarif.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                populatetariflistManualselction(appcontext.getInstance().TarrifJSondata);
                   // MaketarrifdetailPostRequest();
            }
        });

        Button_starttime.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (Button_starttime.getText().toString().equalsIgnoreCase("start")) {

//                    String data = "";//pref.getString("activebookingid");
//                    if(data==null){
//                        data = "";
//                    }
//
//                         if (data.isEmpty()) {
//
//                        //here starting button
//                             AlertDialog.Builder builder = new AlertDialog.Builder(getContext());
//                             builder.setTitle("Enter Passenger Number");
//
//                             final EditText input = new EditText(getContext());
////                             input.setInputType(InputType.TYPE_NUMBER_VARIATION_NORMAL);
// // Specify the type of input expected; this, for example, sets the input as a password, and will mask the text
//                             input.setInputType(InputType.TYPE_CLASS_NUMBER);
//                             builder.setView(input);
//                             builder.setPositiveButton("OK", new DialogInterface.OnClickListener() {
//                                 @Override
//                                 public void onClick(DialogInterface dialog, int which) {
//                                    try {
//                                        numb = input.getText().toString();
//                                        Log.e("number", numb + "");
//                                        if (numb.length() != 12 || numb.substring(0, 1).equalsIgnoreCase("0")) {
//                                            if (numb.substring(0, 1).equalsIgnoreCase("+")) {
//                                                numb = "" + numb.substring(1, numb.length());
//                                            } else {
//                                                numb = "92" + numb.substring(1, numb.length());
//                                            }
//                                        }
//                                        if (numb.length() == 12) {
//                                            dialog.cancel();
//                                            Toast.makeText(appcontext.getInstance().con, "Sending Security code!", Toast.LENGTH_LONG).show();
//                                            MakesmsRequest();
//                                        } else {
//                                            Toast.makeText(con, "Please Type correct number\nExample: 923123456789", Toast.LENGTH_LONG).show();
//                                        }
//
//                                        Log.e("number", numb + "");
//                                        //un comment this to make final job call
//                                        //
//                                    }catch (Exception e){
//                                        e.printStackTrace();
//                                    }
//                                 }
//                             });
//                             builder.setNegativeButton("Cancel", new DialogInterface.OnClickListener() {
//                                 @Override
//                                 public void onClick(DialogInterface dialog, int which) {
//                                     dialog.cancel();
//                                 }
//                             });
//
//                             builder.show();
//
//                         } else {
//                             Toast.makeText(getContext(), "You have an active job, Auto Dispatch activated", Toast.LENGTH_LONG).show();
//                             Button_starttime.setText("COMPLETE");
//                             appcontext.getInstance().activebookingid = pref.getString("activebookingid");
//                             pref.put("activejobpicklatlng", "");
//                             Button_starttime.performClick();
//                         }
                    populatetariflist(appcontext.getInstance().TarrifJSondata);



                }else {

//                    AlertDialog alertDialog = new AlertDialog.Builder (getContext()).create();
//                    alertDialog.setTitle("Metter Response");
//                    alertDialog.setMessage("Metter was started without a booking id\n Please Make sure you have an id");
//                    alertDialog.setButton(AlertDialog.BUTTON_NEUTRAL, "OK",
//                            new DialogInterface.OnClickListener() {
//                                public void onClick(DialogInterface dialog, int which) {
//                                    dialog.dismiss();
//                                    appcontext.getInstance().currentobj.btn_available_fragmentCurrent.performClick();
//                                }
//                            });
//
//                    Button_stoptime.performClick();
//                    alertDialog.show();
//
                    try {
                    pd = ProgressDialog.show(getContext(),"360taxi","Picking current location address..",false,true);

//                    final LocationManager locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
//                    if (ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
//                        // TODO: Consider calling
//                        //    ActivityCompat#requestPermissions
//                        // here to request the missing permissions, and then overriding
//                        //   public void onRequestPermissionsResult(int requestCode, String[] permissions,
//                        //                                          int[] grantResults)
//                        // to handle the case where the user grants the permission. See the documentation
//                        // for ActivityCompat#requestPermissions for more details.
//                        return;
//                    }

//                    Criteria criteria = new Criteria();
//                    criteria.setAccuracy(Criteria.ACCURACY_FINE);
//                    criteria.setPowerRequirement(Criteria.POWER_HIGH);
//
//                    LocationListener locationListener;
//                    locationListener = new LocationListener(){

//                        @Override
//                        public void onLocationChanged(Location location) {
                            // reverse geo-code location
                        locationpick = appcontext.getInstance().realtimelocation;

                    }catch (Exception e){
                        e.printStackTrace();
                    }
                        try {String add="";
                              try {
                                  Geocoder geocoder = new Geocoder(getContext(), Locale.getDefault());
                                  List<Address> addresses = geocoder.getFromLocation(locationpick.getLatitude(), locationpick.getLongitude(), 1);
                                  Address obj = addresses.get(0);
                                  add = obj.getAddressLine(0);

                              }catch (Exception e){
                                  e.printStackTrace();
                              }
                                Log.e("IGA", "Address" + add);
                                pref.put("activejobpicklatlng", "");
                                appcontext.getInstance().mettercalled =1;
                                Button_starttime.setText("Start");
//                                Button_pausetime.performClick();
                                startcheck = 0;

                                appcontext.getInstance().droplatlng = locationpick.getLatitude()+","+locationpick.getLongitude();
                                appcontext.getInstance().droplocation = add;
                                appcontext.getInstance().taximetterservice.stoptime();
                                Button_starttime.setText("START");
                                appcontext.getInstance().metterstatus = "Stopped";

                                getActivity().finish();
//                                try {
//                                    ((MapsActivityJobLocation) getActivity()).onSnapToRoadsButtonClick();
//                                }catch (Exception e){
//                                    e.printStackTrace();
//                                }
                         Intent intnt =    new Intent(getContext(),CurrentJobDetail.class
                            ).putExtra("booking_id",appcontext.getInstance().activebookingid);


                            startActivity(intnt);

//                                Button_stoptime.performClick();

                                // Toast.makeText(this, "Address=>" + add,
                                // Toast.LENGTH_SHORT).show();

                                // TennisAppActivity.showDialog(add);


                            } catch (Exception e) {
                                // TODO Auto-generated catch block
                                e.printStackTrace();

                            }
//                        }
//
//                        @Override
//                        public void onProviderDisabled(String provider) {
//                            // TODO Auto-generated method stub
//
//                        }
//
//                        @Override
//                        public void onProviderEnabled(String provider) {
//                            // TODO Auto-generated method stub
//
//                        }
//
//                        @Override
//                        public void onStatusChanged(String provider, int status,
//                                                    Bundle extras) {
//                            // TODO Auto-generated method stub
//
//                        }
//
//                    };
//                    locationManager.requestSingleUpdate(criteria, locationListener , null);
//


                    //Intent meterintent = new Intent(getContext(), CurrentJobDetail.class);
                  //  startActivity(meterintent);

                }

            }

        });

        Button_pausetime.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {

                if(Button_starttime.getText().toString().equalsIgnoreCase("complete")) {
                    if(Button_pausetime.getText().toString().equalsIgnoreCase("Begin!")){
                        Button_pausetime.setText("Pause");
                        appcontext.getInstance().taximetterservice.starttime();
                        appcontext.getInstance().metterPaused = false;
                    }else {
                        appcontext.getInstance().metterPaused = true;
                        appcontext.getInstance().taximetterservice.pausetime1();
                        //appcontext.getInstance().taximetterservice.waitingstarttime();

                        Button_pausetime.setText("Begin!");
                    }
                }

            }
        });
        Button_cancel.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if(Button_starttime.getText().toString().equalsIgnoreCase("complete")) {

                statusparams = "BookingId,,"+appcontext.getInstance().activebookingid+"" +
                        "&&Status,,"+"Cancel"+"" +
                        "&&DriverId,,"+appcontext.getInstance().DriverId+"" +
                        "&&Vehicleid,,"
                        +pref.getString("SelectedVehicleid")
                        +"&&ZoneId,," +appcontext.getInstance().currentzone;
                method = "FnCancelJobsStatus";
                appcontext.getInstance().backgroundstatus = "Available";
                appcontext.getInstance().timeclock = "00:00:00";
                Button_starttime.setText("START");

                appcontext.getInstance().taximetterservice.stoptime();
                appcontext.getInstance().metterstatus = "finished";
                appcontext.getInstance().ChangestatusRequest();
                makeCancelRequest();
                HashMap<String, Object> data = new HashMap<>();
                data.put("status", "cancel");
                data.put("bookingid", appcontext.getInstance().activebookingid);
                data.put("VehicleId", pref.getString("SelectedVehicleid"));
                data.put("DriverId", appcontext.getInstance().DriverId);
                FirebaseDatabase.getInstance().getReference()
                        .child("Passengerjobs")
                        .child(appcontext.getInstance().JobArrivedDeviceUid)
                        .setValue(data);

            }

            }
        });

//        Button_stoptime.setOnClickListener(new View.OnClickListener() {
//            @Override
//            public void onClick(View view) {
//
//                appcontext.getInstance().taximetterservice.stoptime();
//
//                Button_starttime.setText("START");
//                appcontext.getInstance().metterstatus = "Stopped";
//
//            }
//        });

        return v;
    }


    void makeCancelRequest(){
            StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link ,
                    new Response.Listener<String>() {
                        @Override
                        public void onResponse(String response) {
                            Log.d("dataresp",response.toString());
                            // pd.dismiss();
                            if(response.equalsIgnoreCase("error")){
                                makeCancelRequest();
                            }else {
                                try {
                                    JSONArray jsonArray = new JSONArray(response);
                                    String result = jsonArray.getJSONObject(0).getString("Result");

                                    appcontext.getInstance().backgroundstatus = "Available";
                                    appcontext.getInstance().ChangestatusRequest();
                                    Toast.makeText(getContext(), result, Toast.LENGTH_SHORT).show();

                                }catch (Exception e){
                                    e.printStackTrace();
                                }
                                try {
                                    Toast.makeText(getContext(), new JSONArray(response).getJSONObject(0).getString("Result"), Toast.LENGTH_SHORT).show();
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

                                getActivity().finish();
                                startActivity(new Intent(getContext(), JobView.class));
                                // pd.dismiss();
                                // setdata(response.toString());
                            }

                        }
                    },
                    new Response.ErrorListener() {
                        @Override
                        public void onErrorResponse(VolleyError error) {
                            error.printStackTrace();
                            //   pd.dismiss();

                            Toast.makeText(getContext(), "Please make sure you are connected to internet!", Toast.LENGTH_SHORT).show();
                        }
                    }
            ) {
                // here is params will add to your url using post method
                @Override
                protected Map<String, String> getParams() {
                    Map<String, String> params = new HashMap<>();
//                params.put("BookingId", booking_id );


                    Log.e("jobcanceled",statusparams);
                    params.put("Parms", statusparams);
                    params.put("Action", "FnCancelJobsStatus");
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

void afterzoneselection(){

    Random random = new Random();
    int digit = random.nextInt((10000000 - 10) + 1) + 10;
    final String para = "1";

//    final LocationManager locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
//    if (ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
//        // TODO: Consider calling
//        //    ActivityCompat#requestPermissions
//        // here to request the missing permissions, and then overriding
//        //   public void onRequestPermissionsResult(int requestCode, String[] permissions,
//        //                                          int[] grantResults)
//        // to handle the case where the user grants the permission. See the documentation
//        // for ActivityCompat#requestPermissions for more details.
//        return;
//    }
//
//    Criteria criteria = new Criteria();
//    criteria.setAccuracy(Criteria.ACCURACY_FINE);
//    criteria.setPowerRequirement(Criteria.POWER_HIGH);
//

//    locationManager.requestSingleUpdate(criteria, new LocationListener(){
//
//        @Override
//        public void onLocationChanged(Location location) {
//            // reverse geo-code location

//            locationManager.removeUpdates(this);
//
//
    if(appcontext.getInstance().realtimelocation!=null) {
    locationpick = appcontext.getInstance().realtimelocation;

    try {   String add="";

        try {
                Geocoder geocoder = new Geocoder(getContext(), Locale.getDefault());
                List<Address> addresses = geocoder.getFromLocation(locationpick.getLatitude(), locationpick.getLongitude(), 1);
                Address obj = addresses.get(0);

            add = obj.getAddressLine(0);
            if(appcontext.getInstance().Zonesjsondata.equalsIgnoreCase("[]")){
                    Zonelatlng = locationpick.getLatitude()+","+locationpick.getLongitude();
                    ZoneName = "No Drop Zone selected yet";
                }
                pref.put("activejobpicklatlng",appcontext.getInstance().realtimelocation.getLatitude()+","+appcontext.getInstance().realtimelocation.getLongitude());


                Log.e("IGA", "Address" + add);
                // Toast.makeText(this, "Address=>" + add,
                // Toast.LENGTH_SHORT).show();

                // TennisAppActivity.showDialog(add);

            pd.dismiss();
        }catch (Exception e){
            e.printStackTrace();
        }

        appcontext.getInstance().pickup = add;
        appcontext.getInstance().dropoff = ZoneName;


        DateTime someDate = new DateTime(Long.valueOf(appcontext.getInstance().realtimelocation.getTime()), DateTimeZone.getDefault());
        Log.e("ridetimestart",(someDate.toString().replace("T"," ")).split("\\.")[0]);
                String params = "PickUpZoneId,,"+appcontext.getInstance().currentzone
                        +"&&DriverId,,"+appcontext.getInstance().DriverId
                        +"&&PickLatLng,,"+locationpick.getLatitude()+","
                        +locationpick.getLongitude()+"&&DropLatLng,,"
                        + Zonelatlng +"&&PickAddress,,"+add+"&&DropAddress,,"
                        +ZoneName+"&&VehicleType,,"+appcontext.getInstance().myCarType+"&&BookingType,,FullVehical&&Passengers,,"+1
                        +"&&Bags,,"+para+"&&WheelChairs,,"+para+"&&Info,,"
                        +para+"&&DateTime,,"+someDate.toString().replace("T"," ").split("\\.")[0]
                        +"&&EstimatedDistance,,"+para+"&&EstimatedTime,,"
                        +para+"&&Name,,unknown&&PassengerId,,"+numb+"&&CompanyId,,"
                        +pref.getString("company_id")+"&&VehicleId,,"
                        +pref.getString("SelectedVehicleid");
                Log.e("params",params);
                MakeBookingRequest(params);
//               new bookJob().execute(params);

            } catch (Exception e) {
                Toast.makeText(getContext(), "Couldn't get the pickup address\n  Try again after a minute", Toast.LENGTH_SHORT).show();
                Log.e("geocoding",e.getMessage());
                e.printStackTrace();

            }
    } else {
        pd.dismiss();
        Toast.makeText(getContext(), "Try Again, Couldn't pick the right location", Toast.LENGTH_LONG).show();
    }
//        }
//
//        @Override
//        public void onProviderDisabled(String provider) {
//            // TODO Auto-generated method stub
//
//        }
//
//        @Override
//        public void onProviderEnabled(String provider) {
//            // TODO Auto-generated method stub
//
//        }
//
//        @Override
//        public void onStatusChanged(String provider, int status,
//                                    Bundle extras) {
//            // TODO Auto-generated method stub
//
//        }
//
//    }, null);
}

    void MakeZonesRequest() {
        StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().con.getResources().getString(R.string.FnTarriffDetails),
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("Zonesrequest",response.toString());
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")){
                           // pd.dismiss();
                            MakeZonesRequest();
                            Log.e("tarrifdatarequest","got an error as response");
                        }else {
                            pd.dismiss();
                            Log.e("tarrifdatarequest",response);
                            populateZonelist(response);
                        }
                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //  pd.dismiss();
                        Toast.makeText(getContext(), "Network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                pref = PreferenceManager.getDefaultSharedPreferences(getContext());
//                params.put("CompanyId", pref.getString("company_id","") );
                pref = appcontext.getInstance().pref;

                params.put("Parms", "CompanyId,,"+pref.getString("company_id"));
                params.put("Action", "FnTarriffDetails");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
                // "DriverId="+pref.getInt("FnTarriffDetails",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(getContext()).add(postRequest);
    }

    void populateZonelist(String s){


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
            appcontext.getInstance().startingFare = jsonArray.getJSONObject(0).getString("StartPrice");
            appcontext.getInstance().DistanceRate = jsonArray.getJSONObject(0).getDouble("DistanceRate");
            appcontext.getInstance().WaitingRate = jsonArray.getJSONObject(0).getDouble("WaitingRate");
            Log.e("tarrifdetailssstarting",appcontext.getInstance().startingFare);


            appcontext.getInstance().Tarrifid = TarrifId;
            appcontext.getInstance().TarrifName = Tarrifname;

            txt_tarif.setText(appcontext.getInstance().TarrifName);

        }catch (Exception e){
            Log.e("tarrifdetails",e.getMessage());
            e.printStackTrace();
        }
        if(appcontext.getInstance().Zonesjsondata.equalsIgnoreCase("[]")){
           if (appcontext.getInstance().busyclicked == 1){
                appcontext.getInstance().busyclicked = 0;
                pd = ProgressDialog.show(getContext(),"Taxi360taxi","Picking current location..",false,false);
                afterzoneselection();
            }
        }
      if (appcontext.getInstance().busyclicked == 1){
          appcontext.getInstance().busyclicked = 0;
          Button_starttime.performClick();
      }
    }


    void MaketarrifdetailPostRequest() {
        StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
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
                        Toast.makeText(getContext(), "Network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();

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
//        Volley.newRequestQueue(getContext()).add(postRequest);
    }
    String enteredcode = "";
    void MakesmsRequest() {

        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().con.getResources().getString(R.string.FnTextSending),
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data32",response.toString());
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")){
//                            MaketarrifdetailPostRequest();
                            Log.e("tarrifdatarequest","got an error as response");
                        }else {
                            try {

                                if (response.split(",")[0].equalsIgnoreCase("success")) {
                                    Toast.makeText(appcontext.getInstance().con, "Message Sent!", Toast.LENGTH_SHORT).show();
                                    final String code = response.split(",")[1];
                                    AlertDialog.Builder builder = new AlertDialog.Builder(getContext());
                                    builder.setTitle("Security Code!");

                                    final EditText input = new EditText(getContext());
//                                input.setInputType(InputType.TYPE_NUMBER_VARIATION_NORMAL);
                                    // Specify the type of input expected; this, for example, sets the input as a password, and will mask the text
                                    input.setInputType(InputType.TYPE_CLASS_NUMBER);
                                    builder.setView(input);
                                    builder.setPositiveButton("OK", new DialogInterface.OnClickListener() {
                                        @Override
                                        public void onClick(DialogInterface dialog, int which) {
                                            enteredcode = input.getText().toString();
                                            if (enteredcode.equalsIgnoreCase(code)) {
                                                populateZoneslist(appcontext.getInstance().Zonesjsondata);
                                            }else {
                                                Toast.makeText(appcontext.getInstance().con, "Please enter correct code", Toast.LENGTH_SHORT).show();
                                            }
                                            Log.e("enteredcode", enteredcode + "");
                                            //un comment this to make final job call
                                        }
                                    });
                                    builder.setNegativeButton("Cancel", new DialogInterface.OnClickListener() {
                                        @Override
                                        public void onClick(DialogInterface dialog, int which) {
                                            dialog.cancel();
                                        }
                                    });

                                    builder.show();

                                }else {
                                    Toast.makeText(appcontext.getInstance().con, "Message sending failed", Toast.LENGTH_SHORT).show();
                                }
                            }catch (Exception e){
                                e.printStackTrace();
                            }
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
                Map<String, String> params = new HashMap<>();
//                pref = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
                params.put("Number",numb);
                params.put("code",appcontext.getInstance().smscode);
                params.put("Token", appcontext.getInstance().token);
//                params.put("UserKey", appcontext.getInstance().passforlink);
//                params.put("Action","fnTextSending");
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


    void populatetariflist(String s){

        Log.e("tarrifdata",s);
        try {

            // JSONObject obj = new JSONObject(s);
            // JSONArray json = new JSONArray(s);

            //  Iterator x = obj.keys();

            JSONArray jsonArray = new JSONArray(s);

            listtarrifdata = new ArrayList<>();
            HashtarrifIdandName = new ArrayList<HashMap<String, String>>();



            for (int i = 0; i < jsonArray.length(); i++) {
                HashMap<String, String> map = new HashMap<String, String>();
                String TarrifId = jsonArray.getJSONObject(i).getString("Id");
                String Tarrifname = jsonArray.getJSONObject(i).getString("TariffName");
                listtarrifdata.add(Tarrifname);

                map.put(Tarrifname,TarrifId);
                HashtarrifIdandName.add(map);
                Log.e("tarrifdatax",HashtarrifIdandName.get(i).get(Tarrifname));
            }

            showTarifflistdialog();

        }catch (Exception e){
            e.printStackTrace();
        }
    }


    void showTarifflistdialog(){
        // custom dialog
        final Dialog dialog = new Dialog(getContext());
        dialog.setContentView(R.layout.dailog_tarrifselection);
        dialog.setTitle("Please Select a Tarrif");
        dialog.setCancelable(false);

//        listtarrifdata = new ArrayList<String>();
        // set the custom dialog components
        ListView listView = (ListView) dialog.findViewById(R.id.list_Tarrifs);
        ArrayAdapter<String> arrayAdapter =
                new ArrayAdapter<String>(getContext(),android.R.layout.simple_list_item_1, listtarrifdata);
        // Set The Adapter
        listView.setAdapter(arrayAdapter);

        // register onClickListener to handle click events on each item
        listView.setOnItemClickListener(new AdapterView.OnItemClickListener()
        {
            // argument position gives the index of item which is clicked
            public void onItemClick(AdapterView<?> arg0, View v,int position, long arg3)
            {
                String selectedtarif=listtarrifdata.get(position);
//                Toast.makeText(getContext(), "item Selected : "+selectedtarif,   Toast.LENGTH_LONG).show();
                txt_tarif.setText(selectedtarif);
                appcontext.getInstance().Tarrifid = HashtarrifIdandName.get(position).get(selectedtarif);
                appcontext.getInstance().TarrifName = selectedtarif;
                try {
                    JSONArray jsonArray = new JSONArray(appcontext.getInstance().TarrifJSondata);
                    appcontext.getInstance().startingFare = jsonArray.getJSONObject(position).getString("StartPrice");
                    appcontext.getInstance().DistanceRate = jsonArray.getJSONObject(position).getDouble("DistanceRate");
                    appcontext.getInstance().WaitingRate = jsonArray.getJSONObject(position).getDouble("WaitingRate");

                    Log.e("tarrifid 2",position+" "+jsonArray.getJSONObject(position).getString("StartPrice"));
                    Log.e("tarrifid 2",position+" "+jsonArray.getJSONObject(position).getString("DistanceRate"));
                    Log.e("tarrifid 2",position+" "+jsonArray.getJSONObject(position).getString("WaitingRate"));
                }catch (Exception e){
                    e.printStackTrace();
                }

            }
        });
        dialog.setCancelable(false);
        dialog.show();





        ((Button)dialog.findViewById(R.id.btn_selecttarrif))
                .setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                populateZoneslist(appcontext.getInstance().Zonesjsondata);
                dialog.dismiss();
            }
        });
    }

    void populatetariflistManualselction(String s){

        Log.e("tarrifdata",s);
        try {

            // JSONObject obj = new JSONObject(s);
            // JSONArray json = new JSONArray(s);

            //  Iterator x = obj.keys();

            JSONArray jsonArray = new JSONArray(s);

            listtarrifdata = new ArrayList<>();
            HashtarrifIdandName = new ArrayList<HashMap<String, String>>();



            for (int i = 0; i < jsonArray.length(); i++) {
                HashMap<String, String> map = new HashMap<String, String>();
                String TarrifId = jsonArray.getJSONObject(i).getString("Id");
                String Tarrifname = jsonArray.getJSONObject(i).getString("TariffName");
                listtarrifdata.add(Tarrifname);

                map.put(Tarrifname,TarrifId);
                HashtarrifIdandName.add(map);
                Log.e("tarrifdatax",HashtarrifIdandName.get(i).get(Tarrifname));
            }

            showTarifflistdialogManualselction();

        }catch (Exception e){
            e.printStackTrace();
        }
    }


    void showTarifflistdialogManualselction(){
        // custom dialog
        final Dialog dialog = new Dialog(getContext());
        dialog.setContentView(R.layout.dailog_tarrifselection);
        dialog.setTitle("Please Select a Tarrif");
        dialog.setCancelable(false);

//        listtarrifdata = new ArrayList<String>();
        // set the custom dialog components
        ListView listView = (ListView) dialog.findViewById(R.id.list_Tarrifs);
        ArrayAdapter<String> arrayAdapter =
                new ArrayAdapter<String>(getContext(),android.R.layout.simple_list_item_1, listtarrifdata);
        // Set The Adapter
        listView.setAdapter(arrayAdapter);

        // register onClickListener to handle click events on each item
        listView.setOnItemClickListener(new AdapterView.OnItemClickListener()
        {
            // argument position gives the index of item which is clicked
            public void onItemClick(AdapterView<?> arg0, View v,int position, long arg3)
            {
                String selectedtarif=listtarrifdata.get(position);
//                Toast.makeText(getContext(), "item Selected : "+selectedtarif,   Toast.LENGTH_LONG).show();
                txt_tarif.setText(selectedtarif);
                appcontext.getInstance().Tarrifid = HashtarrifIdandName.get(position).get(selectedtarif);
                appcontext.getInstance().TarrifName = selectedtarif;
                try {
                    JSONArray jsonArray = new JSONArray(appcontext.getInstance().TarrifJSondata);
                    appcontext.getInstance().startingFare = jsonArray.getJSONObject(position).getString("StartPrice");
                    appcontext.getInstance().DistanceRate = jsonArray.getJSONObject(position).getDouble("DistanceRate");
                    appcontext.getInstance().WaitingRate = jsonArray.getJSONObject(position).getDouble("WaitingRate");

                Log.e("tarrifid 2",position+" "+jsonArray.getJSONObject(position).getString("StartPrice"));
                }catch (Exception e){
            e.printStackTrace();
        }

            }
        });
        dialog.setCancelable(false);
        dialog.show();




        ((Button)dialog.findViewById(R.id.btn_selecttarrif))
                .setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View view) {
                        dialog.dismiss();
                    }
                });
    }

    @Override
    public void onStart() {
        super.onStart();
        if (appcontext.getInstance().busyclicked==1){
            pd = ProgressDialog.show(getContext(),"Taxi360taxi","Fetching Data...",false,false);
            MakeZonesRequest();


            Log.e("busystarted the service","");

        }
        try {
            wT.cancel();
        }catch (Exception e){

        }
        try {

            final TextView txt_fare = (TextView) getActivity().findViewById(R.id.fare);
//            final TextView txt_waiting = (TextView) getActivity().findViewById(R.id.waitingtime);
//   LocationManager lMngr = (LocationManager) getSystemService(LOCATION_SERVICE);

            txt_fare.setText(rate + "$");
            final Timer time = new Timer();
            time.scheduleAtFixedRate(new TimerTask() {
                @Override
                public void run() {
                    try {
                        getActivity().runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    double fare = Double.parseDouble(appcontext.getInstance().fare);
                                    double dist = Double.parseDouble(appcontext.getInstance().DistanceCovered);
                                    txt_fare.setText(String.format(String.format("%.2f", fare)));
//                                txt_waiting.setText(appcontext.getInstance().waitingtime);
                                    txt_estimated_time.setText(appcontext.getInstance().timeclock);
                                    txt_distance.setText(String.format(String.format("%.2f", dist)));
                                }catch (Exception e){
                                    e.printStackTrace();
                                }

                            }
                        });
                    }catch (Exception e){
                        time.cancel();
                    }
                }
            }, 1000, 1000);

         //   Toast.makeText(getContext(), "Metter Started", Toast.LENGTH_SHORT).show();
            Log.e("dateLol", currentDateTime);
            new Handler().postDelayed(new Runnable() {
                @Override
                public void run() {
                    txt_estimated_time.setText(appcontext.getInstance().timeclock);
                }
            }, 1000);
        }catch (Exception e){

        }
    }

// this method should be used to create new booking
    void populateZoneslist(String s){

        Log.e("Zonesdatacach",s);
        try {

            JSONArray jsonArray = new JSONArray(s);

            listZonesdata = new ArrayList<>();
            HashZonesIdandName = new ArrayList<HashMap<String, String>>();
            HashZonesLatLng = new ArrayList<HashMap<String, String>>();

            if(s.equalsIgnoreCase("[]")){
                Toast.makeText(getContext(), "Your Company have no Zones in this area.. Moving On", Toast.LENGTH_LONG).show();
                pd = ProgressDialog.show(getContext(),"Taxi360taxi","Picking current location..",false,false);
                afterzoneselection();
            }
            Log.e("zonedatax","reached");

            for (int i = 0; i < jsonArray.length(); i++) {
                HashMap<String, String> map = new HashMap<String, String>();
                HashMap<String, String> maplatlng = new HashMap<String, String>();
                String ZoneId = jsonArray.getJSONObject(i).getString("ZoneId");
                String Zonename = jsonArray.getJSONObject(i).getString("ZoneName");

                maplatlng.put(jsonArray.getJSONObject(i).getString("Lat"),jsonArray.getJSONObject(i).getString("Lng"));
                HashZonesLatLng.add(maplatlng);


                listZonesdata.add(Zonename);

                map.put(Zonename,ZoneId);
                HashZonesIdandName.add(map);



            }
            //afterzoneselection();
            showZoneslistdialog();


        }catch (Exception e){
            Log.e("Zoneerror",e.getMessage());
            e.printStackTrace();
        }
    }

    void showZoneslistdialog(){
        // custom dialog
        final Dialog dialog = new Dialog(getContext());
        dialog.setContentView(R.layout.dailog_tarrifselection);
        dialog.setTitle("Please Select a Drop Zone First, Thank you");
        dialog.setCancelable(false);

//        listtarrifdata = new ArrayList<String>();
        // set the custom dialog components
        ListView listView = (ListView) dialog.findViewById(R.id.list_Tarrifs);
        ArrayAdapter<String> arrayAdapter = new ArrayAdapter<String>(getContext(),android.R.layout.simple_list_item_1, listZonesdata);
        // Set The Adapter
        listView.setAdapter(arrayAdapter);
        Log.e("ZoneSelection",HashZonesLatLng.get(0).toString().replace("=",",").replace("{","").replace("}",""));

        // register onClickListener to handle click events on each item
        listView.setOnItemClickListener(new AdapterView.OnItemClickListener()
        {
            // argument position gives the index of item which is clicked
            public void onItemClick(AdapterView<?> arg0, View v,int position, long arg3)
            {
                String selectedzone=listZonesdata.get(position);
//                Toast.makeText(getContext(), "item Selected : "+selectedzone,   Toast.LENGTH_LONG).show();
                ZoneId = HashZonesIdandName.get(position).get(selectedzone);
                ZoneName = selectedzone;
                Zonelatlng = HashZonesLatLng.get(position).toString().replace("=",",").replace("{","").replace("}","");
                pref.put("activejobdroplatlng",Zonelatlng);

                Log.e("ZoneId",Zonelatlng);
            }
        });
        dialog.show();



        ((Button)dialog.findViewById(R.id.btn_selecttarrif)).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
//               pd = ProgressDialog.show(getContext(),"Taxi360taxi","Picking Current Location",false,false);
                afterzoneselection();
                dialog.dismiss();
            }
        });
    }

    public void performaclickonstart(){
       // Button_starttime.performClick();
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
            if (requestCode == 007 && resultCode == RESULT_OK){
//                extramoney.setText(data.getStringExtra("money"));
                Log.e("money","recieved value");

            }

    }

    void MakeBookingRequest(final String parameter) {
        pd = ProgressDialog.show(getContext(),"Taxi360taxi","Adding new Booking...",false,false);

        StringRequest postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("new job",response.toString());
                        // pd.dismiss();
                        if(response.equalsIgnoreCase("error")){
                            pd.dismiss();
                            Log.e("tarrifdatarequest","got an error as response");

                            MakeBookingRequest(parameter);

                        }else {
                            Log.e("parameter",parameter);
                            pd.dismiss();
                            postbookingrequest(response);
                        }
                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //  pd.dismiss();
                        try {
                            pd.dismiss();
//                            postRequest.cancel();
                        }catch (Exception e){
                            e.printStackTrace();
                        }
                        new Handler().postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                MakeBookingRequest(parameter);
                            }
                        }, 500);

                        Toast.makeText(getContext(), error.getLocalizedMessage()+"Network error"+error.getMessage(), Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();


//                params.put("DriverId", parameter.split("&")[0].split("=")[1]);
//                params.put("PickLatLng", parameter.split("&")[1].split("=")[1]);
//                params.put("DropLatLng", parameter.split("&")[2].split("=")[1]);
//                params.put("PickAddress", parameter.split("&")[3].split("=")[1]);
//                params.put("DropAddress", parameter.split("&")[4].split("=")[1]);
//                params.put("VehicleType", parameter.split("&")[5].split("=")[1]);
//                params.put("BookingType", parameter.split("&")[6].split("=")[1]);
//                params.put("Passengers", parameter.split("&")[7].split("=")[1]);
//                params.put("Bags", parameter.split("&")[8].split("=")[1]);
//                params.put("WheelChairs", parameter.split("&")[9].split("=")[1]);
//                params.put("Info", parameter.split("&")[10].split("=")[1]);
//                params.put("DateTime", parameter.split("&")[11].split("=")[1]);
//                params.put("EstimatedDistance", parameter.split("&")[12].split("=")[1]);
//                params.put("EstimatedTime", parameter.split("&")[13].split("=")[1]);
//                params.put("Name", parameter.split("&")[14].split("=")[1]);
//                params.put("PassengerId",parameter.split("&")[15].split("=")[1]);

                params.put("Parms", parameter);
                params.put("Action", "FnMeterJobAdded");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
                Log.e("paraminside",params.toString());
                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);

//        Volley.newRequestQueue(getContext()).add(postRequest);
    }

    void postbookingrequest(String s){

            pd.dismiss();
        Log.e("unknownmeterss1",s);
        try {
            JSONArray obj = new JSONArray(s);
            String BookingMessage = obj.getJSONObject(0).getString("BookingMessage");
            Toast.makeText(getContext(), BookingMessage, Toast.LENGTH_SHORT).show();
            if(BookingMessage.equalsIgnoreCase("Job Not Approved, please try again")){


            }else if(BookingMessage.equalsIgnoreCase("Ride Successfully Started")) {
                appcontext.getInstance().taximetterservice.starttime();
                appcontext.getInstance().metterstatus = "started";
                Button_starttime.setText("Complete");
                appcontext.getInstance().backgroundstatus="Busy";
                appcontext.getInstance().ChangestatusRequest();
                appcontext.getInstance().activebookingid = obj.getJSONObject(0).getString("BookingId");
                pref.put("activebookingid",appcontext.getInstance().activebookingid);
                Log.e("unknownmeterss",appcontext.getInstance().activebookingid);
            }
        }
        catch (Exception ex){
            Log.e("unknownmeter","error"+ex.getMessage());
        }

    }
//unused
    public class bookJob extends AsyncTask<String,Void,String> {

        String data = "";
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(getContext(),"Taxi360taxi","Adding new Booking...",false,false);
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
                Log.e("error","bokJob"+ex.getMessage());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            pd.dismiss();
            Log.e("unknownmeterss1",s);
            try {
                JSONObject obj = new JSONObject(s);
                String BookingMessage = obj.getString("BookingMessage");
                Toast.makeText(getContext(), BookingMessage, Toast.LENGTH_SHORT).show();
                if(BookingMessage.equalsIgnoreCase("Job Not Approved, please try again")){


                }else if(BookingMessage.equalsIgnoreCase("Job Successfully Approved, Job Status is Active Now")) {
                    appcontext.getInstance().taximetterservice.starttime();
                    appcontext.getInstance().metterstatus = "started";
                    Button_starttime.setText("Complete");

                    appcontext.getInstance().activebookingid = obj.getJSONArray("BookingId").getJSONObject(0).getString("BookingId");
                    pref.put("activebookingid",appcontext.getInstance().activebookingid);
                    Log.e("unknownmeterss",appcontext.getInstance().activebookingid);
                }
            }
            catch (Exception ex){
                Log.e("unknownmeter","error"+ex.getMessage());
            }
        }
    }
}
