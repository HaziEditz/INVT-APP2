/*
  Copyright 2017 Google Inc. All Rights Reserved.
  <p>
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
  <p>
  http://www.apache.org/licenses/LICENSE-2.0
  <p>
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
 */

package com.khybertech.taxi360driver.MainActivity;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Looper;
import android.preference.PreferenceManager;
import android.support.annotation.NonNull;
import android.support.design.widget.Snackbar;
import android.support.v4.app.ActivityCompat;
import android.util.Log;
import android.widget.Button;
import android.widget.TextView;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.RequestQueue;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.R;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.LocationSettingsRequest;
import com.google.android.gms.location.SettingsClient;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.maps.android.PolyUtil;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class Backgroundfusedlocationupdates  {

    Context mcontext = null;
    String ZoneId="";
    StringRequest postRequest;
    RequestQueue requestQueue;
    SecurePreferences pref;

    private static final String TAG = MainActivity.class.getSimpleName();

    /**
     * Code used in requesting runtime permissions.
     */
    private static final int REQUEST_PERMISSIONS_REQUEST_CODE = 34;

    /**
     * Constant used in the location settings dialog.
     */
    private static final int REQUEST_CHECK_SETTINGS = 0x1;

    /**
     * The desired interval for location updates. Inexact. Updates may be more or less frequent.
     */
    private static final long UPDATE_INTERVAL_IN_MILLISECONDS = 8000;

    /**
     * The fastest rate for active location updates. Exact. Updates will never be more frequent
     * than this value.
     */
    private static final long FASTEST_UPDATE_INTERVAL_IN_MILLISECONDS = UPDATE_INTERVAL_IN_MILLISECONDS / 2;

    // Keys for storing activity state in the Bundle.
    private final static String KEY_REQUESTING_LOCATION_UPDATES = "requesting-location-updates";
    private final static String KEY_LOCATION = "location";
    private final static String KEY_LAST_UPDATED_TIME_STRING = "last-updated-time-string";

    /**
     * Provides access to the Fused Location Provider API.
     */
    private FusedLocationProviderClient mFusedLocationClient;


    /**
     * Provides access to the Location Settings API.
     */
    private SettingsClient mSettingsClient;

    /**
     * Stores parameters for requests to the FusedLocationProviderApi.
     */
    private LocationRequest mLocationRequest;

    /**
     * Stores the types of location services the client is interested in using. Used for checking
     * settings to determine if the device has optimal location settings.
     */
    private LocationSettingsRequest mLocationSettingsRequest;

    /**
     * Callback for Location events.
     */
    private LocationCallback mLocationCallback;

    /**
     * Represents a geographical location.
     */
    private Location mCurrentLocation;

    // UI Widgets.
    private Button mStartUpdatesButton;
    private Button mStopUpdatesButton;
    private TextView mLastUpdateTimeTextView;
    private TextView mLatitudeTextView;
    private TextView mLongitudeTextView;

    // Labels.
    private String mLatitudeLabel;
    private String mLongitudeLabel;
    private String mLastUpdateTimeLabel;

    /**
     * Tracks the status of the location updates request. Value changes when the user presses the
     * Start Updates and Stop Updates buttons.
     */
    private Boolean mRequestingLocationUpdates;

    /**
     * Time when the location was updated represented as a String.
     */
    private String mLastUpdateTime;

    public void onCreate() {
//        super.onCreate(savedInstanceState);
//        setContentView(R.layout.backgroundfusedlocationupdatesactivity);
//        Toolbar toolbar = (Toolbar) findViewById(R.id.toolbar);
//        setSupportActionBar(toolbar);
//        // Locate the UI widgets.
//        mStartUpdatesButton = (Button) findViewById(R.id.start_updates_button);
//        mStopUpdatesButton = (Button) findViewById(R.id.stop_updates_button);
//        mLatitudeTextView = (TextView) findViewById(R.id.latitude_text);
//        mLongitudeTextView = (TextView) findViewById(R.id.longitude_text);
//        mLastUpdateTimeTextView = (TextView) findViewById(R.id.last_update_time_text);

        // Set labels.
//        mLatitudeLabel = getResources().getString(R.string.latitude_label);
//        mLongitudeLabel = getResources().getString(R.string.longitude_label);
//        mLastUpdateTimeLabel = getResources().getString(R.string.last_update_time_label);

        mRequestingLocationUpdates = false;
        mLastUpdateTime = "";

        // Update values using data stored in the Bundle.
//        updateValuesFromBundle(savedInstanceState);

        mFusedLocationClient = LocationServices.getFusedLocationProviderClient(mcontext);
        mSettingsClient = LocationServices.getSettingsClient(mcontext);


        // Kick off the process of building the LocationCallback, LocationRequest, and
        // LocationSettingsRequest objects.
        createLocationCallback();
        createLocationRequest();

        buildLocationSettingsRequest();
    }

    /**
     * Updates fields based on data stored in the bundle.
     *
     * @param savedInstanceState The activity state saved in the Bundle.
     */
//    private void updateValuesFromBundle(Bundle savedInstanceState) {
//        if (savedInstanceState != null) {
//            // Update the value of mRequestingLocationUpdates from the Bundle, and make sure that
//            // the Start Updates and Stop Updates buttons are correctly enabled or disabled.
//            if (savedInstanceState.keySet().contains(KEY_REQUESTING_LOCATION_UPDATES)) {
//                mRequestingLocationUpdates = savedInstanceState.getBoolean(
//                        KEY_REQUESTING_LOCATION_UPDATES);
//            }
//
//            // Update the value of mCurrentLocation from the Bundle and update the UI to show the
//            // correct latitude and longitude.
//            if (savedInstanceState.keySet().contains(KEY_LOCATION)) {
//                // Since KEY_LOCATION was found in the Bundle, we can be sure that mCurrentLocation
//                // is not null.
//                mCurrentLocation = savedInstanceState.getParcelable(KEY_LOCATION);
//            }
//
//            // Update the value of mLastUpdateTime from the Bundle and update the UI.
//            if (savedInstanceState.keySet().contains(KEY_LAST_UPDATED_TIME_STRING)) {
//                mLastUpdateTime = savedInstanceState.getString(KEY_LAST_UPDATED_TIME_STRING);
//            }
//            updateUI();
//        }
//    }

    /**
     * Sets up the location request. Android has two location request settings:
     * {@code ACCESS_COARSE_LOCATION} and {@code ACCESS_FINE_LOCATION}. These settings control
     * the accuracy of the current location. This sample uses ACCESS_FINE_LOCATION, as defined in
     * the AndroidManifest.xml.
     * <p/>
     * When the ACCESS_FINE_LOCATION setting is specified, combined with a fast update
     * interval (5 seconds), the Fused Location Provider API returns location updates that are
     * accurate to within a few feet.
     * <p/>
     * These settings are appropriate for mapping applications that show real-time location
     * updates.
     */
    private void createLocationRequest() {
        mLocationRequest = new LocationRequest();

        // Sets the desired interval for active location updates. This interval is
        // inexact. You may not receive updates at all if no location sources are available, or
        // you may receive them slower than requested. You may also receive updates faster than
        // requested if other applications are requesting location at a faster interval.
//        mLocationRequest.setInterval(UPDATE_INTERVAL_IN_MILLISECONDS);

        mLocationRequest.setInterval(200)
                .setFastestInterval(0)
                .setMaxWaitTime(1000)
                .setSmallestDisplacement(0)
                .setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY);
        // Sets the fastest rate for active location updates. This interval is exact, and your
        // application will never receive updates faster than this value.

//        mLocationRequest.setFastestInterval(FASTEST_UPDATE_INTERVAL_IN_MILLISECONDS);
       // mLocationRequest.setSmallestDisplacement(50.0f);

//        mLocationRequest.setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY);
    }

    /**
     * Creates a callback for receiving location events.
     */
    private void createLocationCallback() {
        mLocationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                super.onLocationResult(locationResult);
                try {
                    mCurrentLocation = locationResult.getLocations().get(0);
                    for (int i = 0; i < locationResult.getLocations().size(); i++) {
                        if (mCurrentLocation.getAccuracy() > locationResult.getLocations().get(i).getAccuracy()) {
                            mCurrentLocation = locationResult.getLocations().get(i);
                        }
                    }

                    if(appcontext.getInstance().backgroundstatus.equalsIgnoreCase("picking")){
                        ToneGenerator toneGen1 = new ToneGenerator(AudioManager.STREAM_MUSIC, 150);
                        toneGen1.startTone(ToneGenerator.TONE_SUP_RINGTONE,150);
                    }

//                mCurrentLocation = locationResult.getLastLocation();
                    Log.e("lastknown", mCurrentLocation.getLatitude() + " " + mCurrentLocation.getLongitude());
                    mLastUpdateTime = DateFormat.getTimeInstance().format(new Date());
                    updateLocationUI();
                }catch (Exception e){
                    e.printStackTrace();
                }
            }
        };
    }

    /**
     * Uses a {@link com.google.android.gms.location.LocationSettingsRequest.Builder} to build
     * a {@link com.google.android.gms.location.LocationSettingsRequest} that is used for checking
     * if a device has the needed location settings.
     */
    private void buildLocationSettingsRequest() {
        LocationSettingsRequest.Builder builder = new LocationSettingsRequest.Builder();
        builder.addLocationRequest(mLocationRequest);
        mLocationSettingsRequest = builder.build();



    }

//    @Override
//    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
//        switch (requestCode) {
//            // Check for the integer request code originally supplied to startResolutionForResult().
//            case REQUEST_CHECK_SETTINGS:
//                switch (resultCode) {
//                    case Activity.RESULT_OK:
//                        Log.i(TAG, "User agreed to make required location settings changes.");
//                        // Nothing to do. startLocationupdates() gets called in onResume again.
//                        break;
//                    case Activity.RESULT_CANCELED:
//                        Log.i(TAG, "User chose not to make required location settings changes.");
//                        mRequestingLocationUpdates = false;
//                        updateUI();
//                        break;
//                }
//                break;
//        }
//    }

    /**
     * Handles the Start Updates button and requests start of location updates. Does nothing if
     * updates have already been requested.
     */
    public void startUpdatesButtonHandler() {

        onCreate();
        Log.e("oncreatcalled","yes location");
        if (!mRequestingLocationUpdates) {
            mRequestingLocationUpdates = true;
//            setButtonsEnabledState();
            startLocationUpdates();

        }
    }

    /**
     * Handles the Stop Updates button, and requests removal of location updates.
     */
    public void stopUpdatesButtonHandler() {
        // It is a good practice to remove location requests when the activity is in a paused or
        // stopped state. Doing so helps battery performance and is especially
        // recommended in applications that request frequent location updates.
        stopLocationUpdates();
    }

    /**
     * Requests location updates from the FusedLocationApi. Note: we don't call this unless location
     * runtime permission has been granted.
     */
    private void startLocationUpdates() {
        // Begin by checking if the device has the necessary location settings.
//        mSettingsClient.checkLocationSettings(mLocationSettingsRequest)
//                .addOnSuccessListener((Activity)mcontext, new OnSuccessListener<LocationSettingsResponse>() {
//                    @Override
//                    public void onSuccess(LocationSettingsResponse locationSettingsResponse) {
//                        Log.e("fused", "All location settings are satisfied.");

//                        //noinspection MissingPermission
                        if (ActivityCompat.checkSelfPermission(mcontext, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(mcontext, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                            // TODO: Consider calling
                            //    ActivityCompat#requestPermissions
                            // here to request the missing permissions, and then overriding
                            //   public void onRequestPermissionsResult(int requestCode, String[] permissions,
                            //                                          int[] grantResults)
                            // to handle the case where the user grants the permission. See the documentation
                            // for ActivityCompat#requestPermissions for more details.
                            return;
                        }
                        mFusedLocationClient.requestLocationUpdates(mLocationRequest,
                                mLocationCallback, Looper.myLooper());

                        updateUI();
//                    }
//                })
//                .addOnFailureListener((Activity)mcontext, new OnFailureListener() {
//                    @Override
//                    public void onFailure(@NonNull Exception e) {
//                        int statusCode = ((ApiException) e).getStatusCode();
//                        switch (statusCode) {
//                            case LocationSettingsStatusCodes.RESOLUTION_REQUIRED:
//                                Log.e("fused", "Location settings are not satisfied. Attempting to upgrade " +
//                                        "location settings ");
//                                try {
//                                    // Show the dialog by calling startResolutionForResult(), and check the
//                                    // result in onActivityResult().
//                                    ResolvableApiException rae = (ResolvableApiException) e;
//                                    rae.startResolutionForResult((Activity)mcontext, REQUEST_CHECK_SETTINGS);
//                                } catch (IntentSender.SendIntentException sie) {
//                                    Log.i(TAG, "PendingIntent unable to execute request.");
//                                }
//                                break;
//                            case LocationSettingsStatusCodes.SETTINGS_CHANGE_UNAVAILABLE:
//                                String errorMessage = "Location settings are inadequate, and cannot be " +
//                                        "fixed here. Fix in Settings.";
//                                Log.e(TAG, errorMessage);
//                                Toast.makeText(mcontext, errorMessage, Toast.LENGTH_LONG).show();
//                                mRequestingLocationUpdates = false;
//                        }
//
//                        updateUI();
//                    }
//                });
    }

    /**
     * Updates all UI fields.
     */
    private void updateUI() {
//        setButtonsEnabledState();
        updateLocationUI();
    }

    /**
     * Disables both buttons when functionality is disabled due to insuffucient location settings.
     * Otherwise ensures that only one button is enabled at any time. The Start Updates button is
     * enabled if the user is not requesting location updates. The Stop Updates button is enabled
     * if the user is requesting location updates.
     */
    private void setButtonsEnabledState() {
        if (mRequestingLocationUpdates) {
//            mStartUpdatesButton.setEnabled(false);
//            mStopUpdatesButton.setEnabled(true);
        } else {
//            mStartUpdatesButton.setEnabled(true);
//            mStopUpdatesButton.setEnabled(false);
        }
    }


    void firebaseUpdateDriverLatlng (final LatLng sydney, final int speed, final String UpdateDateTime){
        try {

            String uid = FirebaseAuth.getInstance().getCurrentUser().getUid();

            Log.e("firebaseuid",uid);


//            final SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(mcontext);

            pref = appcontext.getInstance().pref;
            DatabaseReference dbRef = FirebaseDatabase.getInstance().getReference().child("online");

            HashMap<String, Object> data = new HashMap<>();
            data.put("lat",sydney.latitude+"");
            data.put("lng", sydney.longitude+"");
            data.put("drivername", pref.getString("name"));
            data.put("vehiclestatus",appcontext.getInstance().backgroundstatus);

            data.put("speed",speed+"");
            data.put("vehiclenumber",pref.getString("SelectedVehicleName"));

//            data.put("VehicleId",pref.getString("SelectedVehicleid"));
            data.put("time",UpdateDateTime+"");


            dbRef.child(pref.getString("company_id"))
                    .child(pref.getString("SelectedVehicleid") + "")
                    .child(uid+"").setValue(data);

            Log.e("firebasetime1",UpdateDateTime);
        }catch (Exception e){
            Log.e("firebaselatlng",e.getMessage());
            e.printStackTrace();
        }


    }




    void MakePostRequest(String url_current, final LatLng sydney, final int speed, final String UpdateDateTime) {

        postRequest = new StringRequest(Request.Method.POST, url_current,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("locationupdated",response.toString());
                        // pd.dismiss();
                        //setdata(response);

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        //  Toast.makeText(getContext(), "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                final SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(mcontext);
                SecurePreferences pref = appcontext.getInstance().pref;
//                                    Log.e("locationupdatesparam", params);
                String param = "lat,,"+sydney.latitude+"&&lng,,"+sydney.longitude+"&&DriverId,,"+appcontext.getInstance().DriverId+"&&VehicleSpeed,,"+speed+"&&UpdateDateTime,," + UpdateDateTime+"&&VehicleId,,"+pref.getString("SelectedVehicleid");



                params.put("Parms", param);
                params.put("Action", "DriverVehicleLocationUpdate");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
                Log.e("locationupdatesparam", params.toString());
                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));


        appcontext.getInstance().mRequestQueue.add(postRequest);

//        requestQueue = Volley.newRequestQueue(mcontext);
//        requestQueue.add(postRequest);
    }



    void MakeAllZonesrequest() {
        Log.d("httpsSSL", "called");
        postRequest = new StringRequest(Request.Method.POST, mcontext.getString(R.string.FnCompanyAllZones),

                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("httpsSSLresponse", response.toString());
                        try {

//                            final SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(mcontext);
                            SecurePreferences pref = appcontext.getInstance().pref;
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
//                    final SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(mcontext);
                    SecurePreferences pref = appcontext.getInstance().pref;
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
//            appcontext.getInstance().mRequestQueue.add(postRequest);
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(mcontext).add(postRequest);
    }




    void MakeUpdateVehicleZonerequest() {
        Log.d("httpsSSL", "called");
        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,

                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("httpsUpdateVehicleZoneresponse", response.toString());

                      try {
//                                                pref.edit().putString("AllZones", s);
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
//                    final SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(mcontext);
                    SecurePreferences pref = appcontext.getInstance().pref;
                    String param = "VehicleId,," + pref.getString("SelectedVehicleid")
                            +"&&VehicleStatus,,"+appcontext.getInstance().backgroundstatus
                            + "&&ZoneId,," + ZoneId;


                    params.put("Parms", param);
                    params.put("Action", "FnUpdateVehicleZone");
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
//        Volley.newRequestQueue(mcontext).add(postRequest);
    }


    /**
     * Sets the value of the UI fields for the location latitude, longitude and last update time.
     */

    private void updateLocationUI() {

        if (mCurrentLocation != null) {
//            mLatitudeTextView.setText(String.format(Locale.ENGLISH, "%s: %f", mLatitudeLabel,
//                    mCurrentLocation.getLatitude()));
//            mLongitudeTextView.setText(String.format(Locale.ENGLISH, "%s: %f", mLongitudeLabel,
//                    mCurrentLocation.getLongitude()));
            // this is where accuracy was checked but not anymore
            if(true) {
//                final SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(mcontext);
                SecurePreferences pref = appcontext.getInstance().pref;
                try {
                    if (pref.getString("AllZones")==null) {
                        MakeAllZonesrequest();
//                        new AsyncTask<Void, Void, String>() {
//                            String data = "";
//                            String currentDateTimeloc = "";
//                            int driverId;
//
//                            @Override
//                            protected void onPreExecute() {
//                                super.onPreExecute();
//                                Calendar c = Calendar.getInstance();
//                                SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
//                                currentDateTimeloc = format.format(c.getTime());
//                                driverId = pref.getInt("user_id", 0);
//                            }
//
//                            @Override
//                            protected String doInBackground(Void... voids) {
//                                try {
//                                    URL url = new URL(mcontext.getString(R.string.FnCompanyAllZones));//"http://webservices.cabs.wiki/api/DriverApp/DriverVehicleLocationUpdate");
//                                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
//                                    conn.setDoOutput(true);
//                                    conn.setRequestMethod("POST");
//                                    final SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(mcontext);
//                                    String params = "CompanyId=" + pref.getString("company_id", "");
//                                    Log.e("zonesupdatrecieverparam", params);
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
//                                try {
//                                    pref.edit().putString("AllZones", s).commit();
//                                    Log.e("locationupdateresponse", s);
//                                } catch (Exception e) {
//                                    e.printStackTrace();
//                                }
//
//                            }
//                        }.execute();
                    }



                    final LatLng sydney = new LatLng(mCurrentLocation.getLatitude(), mCurrentLocation.getLongitude());

//                    int speed = (int) ((mCurrentLocation.getSpeed() * 3600) / 1000);
                    int speed = 7;
                    Log.e("hasspeed",mCurrentLocation.hasSpeed()+"");
                    if(mCurrentLocation.hasSpeed())
                        speed = (int) ((mCurrentLocation.getSpeed() * 3600) / 1000);
                    Log.e("Current speed: ",speed+"");
                    if(speed > appcontext.getInstance().maxSpeed){
                        appcontext.getInstance().maxSpeed = speed;
                    }
                    if(appcontext.getInstance().metterstatus.equalsIgnoreCase("started")) {
//                        Log.e("Speed has",mCurrentLocation.getSpeedAccuracyMetersPerSecond()+"");
                        if (speed < 15 ) {
                            appcontext.getInstance().mIsVehicleOnWait = true;
//                            appcontext.getInstance().taximetterservice.waitingstarttime();
                            Log.e("speed waitingtime:", appcontext.getInstance().waitingtime);
                        } else {
                            appcontext.getInstance().mIsVehicleOnWait  = false;
//                            appcontext.getInstance().taximetterservice.pauseWaitingtime();
                            Log.e("speed pausedtime:", appcontext.getInstance().waitingtime);
                        }
                    }
//                    if(appcontext.getInstance().prevRealtimeloccation.distanceTo(mCurrentLocation)>=100.0f) {
                        appcontext.getInstance().prevRealtimeloccation = mCurrentLocation;
//                        new AsyncTask<Void, Void, String>() {
//                            String data = "";
//                            int driverId;
                            String currentDateTimeloc = "";
//
//                            @Override
//                            protected void onPreExecute() {
//                                super.onPreExecute();
//
                                Calendar c = Calendar.getInstance();
                                SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy KK:mm:ss a", Locale.ENGLISH);
                                currentDateTimeloc = format.format(c.getTime());
//                                driverId = pref.getInt("user_id", 0);
//                            }
//
//                            @Override
//                            protected String doInBackground(Void... voids) {
//                                try {
//                                    URL url = new URL(mcontext.getString(R.string.DriverVehicleLocationUpdate));//"http://webservices.cabs.wiki/api/DriverApp/DriverVehicleLocationUpdate");
//                                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
//                                    conn.setDoOutput(true);
//                                    conn.setRequestMethod("POST");
//                                    String params = "Lat=" + sydney.latitude + "&Lng=" + sydney.longitude + "&DriverId=" + driverId + "&VehicleSpeed=" + speed + "&UpdateDateTime=" + currentDateTimeloc + "&VehicleId=" + pref.getString("SelectedVehicleid", "");
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
//                                try {
//
//                                    Log.e("locationupdateresponse", s);
//                                } catch (Exception e) {
//                                    e.printStackTrace();
//                                }
//
//                            }
//                        }.execute();

                        try{
                            if(requestQueue!=null) {
                                requestQueue.cancelAll(new RequestQueue.RequestFilter() {
                                    @Override
                                    public boolean apply(Request<?> request) {
                                        return true;
                                    }
                                });
                            }
                        }catch (Exception e){
                            e.printStackTrace();
                        }
                        String dat = "";
                        if (pref.getString("Shiftstatus")==null){
                            dat = "";
                        }else {
                           dat = pref.getString("Shiftstatus").toString();
                        }

                    if(dat.equalsIgnoreCase("started")) {
                        try{
                         firebaseUpdateDriverLatlng(sydney, speed, currentDateTimeloc);
                         if(appcontext.getInstance().shiftlocationslist==null){
                             appcontext.getInstance().shiftlocationslist = new ArrayList<>();
                         }else {
                             appcontext.getInstance().shiftlocationslist.add(new LatLng(mCurrentLocation.getLatitude(), mCurrentLocation.getLongitude()));
                         }
                    }catch (Exception e){
                            e.printStackTrace();
                        }
//    MakePostRequest(mcontext.getString(R.string.DriverVehicleLocationUpdate), sydney, speed, currentDateTimeloc);
                    }
//                    }
                }catch (Exception e){
                    e.printStackTrace();
                }
try {
    Log.e("RealTimeLatlngHigh", mCurrentLocation.getProvider() + " " + mCurrentLocation.getAccuracy() + " " + mCurrentLocation.getLatitude() + "," + mCurrentLocation.getLongitude());
    appcontext.getInstance().realtimelocation = mCurrentLocation;
}catch (Exception e){

}
                if(!pref.getString("AllZones").equalsIgnoreCase("")) {
                    try {
                        JSONArray arr = new JSONArray(pref.getString("AllZones"));
                        for (int i = 0; i < arr.length(); i++) {
                            JSONObject obj = arr.getJSONObject(i);

                            ZoneId = obj.getString("ZoneId");
                            Log.e("zoneid", ZoneId);
                            String[] latlng = obj.getString("LatLng").substring(0,obj.getString("LatLng").length()-1).split("N");

                            LatLng latLng = new LatLng(mCurrentLocation.getLatitude(), mCurrentLocation.getLongitude());
                            List<LatLng> polyPointsList = new ArrayList<LatLng>();
                            for (String lat : latlng) {
                                polyPointsList.add(new LatLng(Double.parseDouble(lat.split(",")[0]), Double.parseDouble(lat.split(",")[1])));
                            }

                            polyPointsList.add(new LatLng(Double.parseDouble(latlng[0].split(",")[0]), Double.parseDouble(latlng[0].split(",")[1])));


                            if (PolyUtil.containsLocation(latLng, polyPointsList, true)) {
                                Log.e("is point in poly:" + ZoneId, PolyUtil.containsLocation(latLng, polyPointsList, false) + "");
                                if (!ZoneId.equalsIgnoreCase(appcontext.getInstance().currentzone)) {
                                    Log.e("zoneupdated", "yes");
                                    MakeUpdateVehicleZonerequest();
//                                    new AsyncTask<Void, Void, String>() {
//                                        String data = "";
//                                        String currentDateTimeloc = "";
//
//                                        @Override
//                                        protected void onPreExecute() {
//                                            super.onPreExecute();
//                                            Calendar c = Calendar.getInstance();
//                                            SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
//                                            currentDateTimeloc = format.format(c.getTime());
////                                        driverId = pref.getInt("user_id", 0);
//                                        }
//
//                                        @Override
//                                        protected String doInBackground(Void... voids) {
//                                            try {
//                                                URL url = new URL(mcontext.getString(R.string.FnUpdateVehicleZone));//"http://webservices.cabs.wiki/api/DriverApp/DriverVehicleLocationUpdate");
//                                                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
//                                                conn.setDoOutput(true);
//                                                conn.setRequestMethod("POST");
////                                            VehicleId, ZoneId
//                                                String params = "VehicleId=" + pref.getString("SelectedVehicleid", "") + "&ZoneId=" + ZoneId;
//                                                Log.e("zoneUpdatedparam", params);
//                                                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
//                                                writer.write(params);
//                                                writer.flush();
//                                                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
//                                                data = reader.readLine();
//                                            } catch (Exception ex) {
//                                                Log.e("error", ex.getLocalizedMessage());
//                                            }
//                                            return data;
//                                        }
//
//                                        @Override
//                                        protected void onPostExecute(String s) {
//                                            super.onPostExecute(s);
//                                            try {
//                                                if(s.equalsIgnoreCase("Zone updated")){
//                                                    appcontext.getInstance().currentzone = ZoneId;
//                                                }else {
//                                                    appcontext.getInstance().currentzone = "-112";
//                                                }
//
//                                            } catch (Exception e) {
//                                                e.printStackTrace();
//                                            }
//
//                                        }
//                                    }.execute();
                                    appcontext.getInstance().currentzone = ZoneId;
                                }

                                break;
                            }
                         if(i==arr.length()-1){

                             if (!ZoneId.equalsIgnoreCase(appcontext.getInstance().currentzone)) {
                                 ZoneId = "0";
                                 MakeUpdateVehicleZonerequest();
//                             new AsyncTask<Void, Void, String>() {
//                                 String data = "";
//                                 String currentDateTimeloc = "";
//
//                                 @Override
//                                 protected void onPreExecute() {
//                                     super.onPreExecute();
//                                     Calendar c = Calendar.getInstance();
//                                     SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
//                                     currentDateTimeloc = format.format(c.getTime());
////                                        driverId = pref.getInt("user_id", 0);
//                                 }
//
//                                 @Override
//                                 protected String doInBackground(Void... voids) {
//                                     try {
//                                         URL url = new URL(mcontext.getString(R.string.FnUpdateVehicleZone));//"http://webservices.cabs.wiki/api/DriverApp/DriverVehicleLocationUpdate");
//                                         HttpURLConnection conn = (HttpURLConnection) url.openConnection();
//                                         conn.setDoOutput(true);
//                                         conn.setRequestMethod("POST");
////                                            VehicleId, ZoneId
//                                         String params = "VehicleId=" + pref.getString("SelectedVehicleid", "") + "&ZoneId=" + ZoneId;
//                                         Log.e("zoneUpdatedparam", params);
//                                         OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
//                                         writer.write(params);
//                                         writer.flush();
//                                         BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
//                                         data = reader.readLine();
//                                     } catch (Exception ex) {
//                                         Log.e("error", ex.getLocalizedMessage());
//                                     }
//                                     return data;
//                                 }
//
//                                 @Override
//                                 protected void onPostExecute(String s) {
//                                     super.onPostExecute(s);
//                                     try {
////                                                pref.edit().putString("AllZones", s);
//                                         Log.e("locationupdateresponse", s);
//                                     } catch (Exception e) {
//                                         e.printStackTrace();
//                                     }
//
//                                 }
//                             }.execute();
                                 appcontext.getInstance().currentzone = ZoneId;
                             }
                         }
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }

                }
            }else {
                try {
                    Log.e("RealTimeLatlngLow", mCurrentLocation.getAccuracy() + " " + mCurrentLocation.getLatitude() + "," + mCurrentLocation.getLongitude());
                }catch (Exception e){
                    e.printStackTrace();
                }
            }



//            mLastUpdateTimeTextView.setText(String.format(Locale.ENGLISH, "%s: %s",
//                    mLastUpdateTimeLabel, mLastUpdateTime));
        }
    }

    /**
     * Removes location updates from the FusedLocationApi.
     */
    private void stopLocationUpdates() {
        if (!mRequestingLocationUpdates) {
            Log.d(TAG, "stopLocationUpdates: updates never requested, no-op.");
            return;
        }

        // It is a good practice to remove location requests when the activity is in a paused or
        // stopped state. Doing so helps battery performance and is especially
        // recommended in applications that request frequent location updates.
        mFusedLocationClient.removeLocationUpdates(mLocationCallback)
                .addOnCompleteListener((Activity)mcontext, new OnCompleteListener<Void>() {
                    @Override
                    public void onComplete(@NonNull Task<Void> task) {
                        mRequestingLocationUpdates = false;
                        setButtonsEnabledState();
                    }
                });
    }
//
//    @Override
//    public void onResume() {
//        super.onResume();
//        // Within {@code onPause()}, we remove location updates. Here, we resume receiving
//        // location updates if the user has requested them.
//        if (mRequestingLocationUpdates && checkPermissions()) {
//            startLocationUpdates();
//        } else if (!checkPermissions()) {
//            requestPermissions();
//        }
//
//        updateUI();
//    }

//    @Override
//    protected void onPause() {
//        super.onPause();
//
//        // Remove location updates to save battery.
//        stopLocationUpdates();
//    }

//    /**
//     * Stores activity data in the Bundle.
//     */
//    public void onSaveInstanceState(Bundle savedInstanceState) {
//        savedInstanceState.putBoolean(KEY_REQUESTING_LOCATION_UPDATES, mRequestingLocationUpdates);
//        savedInstanceState.putParcelable(KEY_LOCATION, mCurrentLocation);
//        savedInstanceState.putString(KEY_LAST_UPDATED_TIME_STRING, mLastUpdateTime);
//        super.onSaveInstanceState(savedInstanceState);
//    }

    /**
     * Shows a {@link Snackbar}.
     *
     * @param mainTextStringId The id for the string resource for the Snackbar text.
     * @param actionStringId   The text of the action item.
     * @param listener         The listener associated with the Snackbar action.
     */
//    private void showSnackbar(final int mainTextStringId, final int actionStringId,
//                              View.OnClickListener listener) {
//        Snackbar.make(
//                findViewById(android.R.id.content),
//                getString(mainTextStringId),
//                Snackbar.LENGTH_INDEFINITE)
//                .setAction(getString(actionStringId), listener).show();
//    }

//    /**
//     * Return the current state of the permissions needed.
//     */
//    private boolean checkPermissions() {
//        int permissionState = ActivityCompat.checkSelfPermission(this,
//                Manifest.permission.ACCESS_FINE_LOCATION);
//        return permissionState == PackageManager.PERMISSION_GRANTED;
//    }

//    private void requestPermissions() {
//        boolean shouldProvideRationale =
//                ActivityCompat.shouldShowRequestPermissionRationale(this,
//                        Manifest.permission.ACCESS_FINE_LOCATION);
//
//        // Provide an additional rationale to the user. This would happen if the user denied the
//        // request previously, but didn't check the "Don't ask again" checkbox.
//        if (shouldProvideRationale) {
//            Log.i(TAG, "Displaying permission rationale to provide additional context.");
////            showSnackbar(R.string.permission_rationale,
////                    android.R.string.ok, new View.OnClickListener() {
////                        @Override
////                        public void onClick(View view) {
////                            // Request permission
////                            ActivityCompat.requestPermissions(Backgroundfusedlocationupdates.this,
////                                    new String[]{Manifest.permission.ACCESS_FINE_LOCATION},
////                                    REQUEST_PERMISSIONS_REQUEST_CODE);
////                        }
////                    });
//        } else {
//            Log.i(TAG, "Requesting permission");
//            // Request permission. It's possible this can be auto answered if device policy
//            // sets the permission in a given state or the user denied the permission
//            // previously and checked "Never ask again".
////            ActivityCompat.requestPermissions(Backgroundfusedlocationupdates.this,
////                    new String[]{Manifest.permission.ACCESS_FINE_LOCATION},
////                    REQUEST_PERMISSIONS_REQUEST_CODE);
//        }
//    }

    /**
     * Callback received when a permissions request has been completed.
     */
//    @Override
//    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
//                                           @NonNull int[] grantResults) {
//        Log.i(TAG, "onRequestPermissionResult");
//        if (requestCode == REQUEST_PERMISSIONS_REQUEST_CODE) {
//            if (grantResults.length <= 0) {
//                // If user interaction was interrupted, the permission request is cancelled and you
//                // receive empty arrays.
//                Log.i(TAG, "User interaction was cancelled.");
//            } else if (grantResults[0] == PackageManager.PERMISSION_GRANTED) {
//                if (mRequestingLocationUpdates) {
//                    Log.i(TAG, "Permission granted, updates requested, starting location updates");
//                    startLocationUpdates();
//                }
//            } else {
//                // Permission denied.
//
//                // Notify the user via a SnackBar that they have rejected a core permission for the
//                // app, which makes the Activity useless. In a real app, core permissions would
//                // typically be best requested during a welcome-screen flow.
//
//                // Additionally, it is important to remember that a permission might have been
//                // rejected without asking the user for permission (device policy or "Never ask
//                // again" prompts). Therefore, a user interface affordance is typically implemented
//                // when permissions are denied. Otherwise, your app could appear unresponsive to
//                // touches or interactions which have required permissions.
////                showSnackbar(R.string.permission_denied_explanation,
////                        R.string.settings, new View.OnClickListener() {
////                            @Override
////                            public void onClick(View view) {
////                                // Build intent that displays the App settings screen.
////                                Intent intent = new Intent();
////                                intent.setAction(
////                                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
////                                Uri uri = Uri.fromParts("package",
////                                        BuildConfig.APPLICATION_ID, null);
////                                intent.setData(uri);
////                                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
////                                startActivity(intent);
////                            }
////                        });
//            }
//        }
//    }
//



}
