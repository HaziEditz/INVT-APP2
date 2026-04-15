package com.khybertech.taxi360driver.Maps;

import android.Manifest;
import android.content.ComponentName;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.IBinder;
import android.preference.PreferenceManager;
import android.support.v4.app.ActivityCompat;
import android.support.v4.app.FragmentActivity;
import android.os.Bundle;
import android.support.v4.app.FragmentManager;
import android.support.v4.app.FragmentTransaction;
import android.support.v7.app.AlertDialog;
import android.util.Log;
import android.util.LongSparseArray;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.NetworkResponse;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.ServerError;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.HttpHeaderParser;
import com.android.volley.toolbox.StringRequest;
import com.android.volley.toolbox.Volley;
import com.crashlytics.android.Crashlytics;
import com.google.maps.android.PolyUtil;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.MainActivity.Taximetterservice;
import com.khybertech.taxi360driver.R;
import com.cs.googlemaproute.DrawRoute;
import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.SupportMapFragment;
import com.google.android.gms.maps.model.BitmapDescriptor;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.LatLngBounds;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;

import com.google.android.gms.maps.model.Polyline;
import com.google.android.gms.maps.model.PolylineOptions;
import com.google.maps.GeoApiContext;
import com.google.maps.GeocodingApi;
import com.google.maps.RoadsApi;
import com.google.maps.android.SphericalUtil;
import com.google.maps.android.ui.IconGenerator;
import com.google.maps.model.GeocodingResult;
import com.google.maps.model.SnappedPoint;
import com.google.maps.model.SpeedLimit;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParserException;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Timer;
import java.util.TimerTask;
//......................................................
//............................................................

//import com.google.maps.model.LatLng;

//import android.support.v7.app.ActionBarActivity;


public class MapsActivityJobLocation extends FragmentActivity implements OnMapReadyCallback, DrawRoute.onDrawRoute {

    private GoogleMap mMap;
    int lastsnap = 0;
    int onstartactivity = 0;
    Timer time;
    String firebasejob="";
    Intent i;
    String pickLatLong, pickLat, pickLong, dropLatLong, dropLat, dropLong;
    LatLng start, end;
    MarkerOptions markerOptions;
    TextView txt_speed, txt_estimated_distance, txt_estimated_time,txt_fare;
    Marker Drivermarker = null;
    SecurePreferences pref;
    int DriverId = 0;
    Calendar c;
    SimpleDateFormat format;
    String currentDateTime = "";
    Location temp = null;
    double completeDistance = 0;
    Location previousLocation = null;
    int countLoc = 0;
    int countTime = 0;
    Button btn_completejob_maps_job_location;
    LocationManager lMngr;
    LocationListener lStnr;
    int whocaledme = 0;

    Polyline polyline ;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_maps_job_location);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        try {
            FragmentManager fragmentManager = getSupportFragmentManager();
            FragmentTransaction fragmentTransaction = fragmentManager.beginTransaction();
            fragmentTransaction.add(R.id.fragment_container, appcontext.getInstance().taximetterfragment, "HELLO");
            fragmentTransaction.commit();
        }catch (Exception e){
            e.printStackTrace();

        }
        roadmapinit();
//        pref = PreferenceManager.getDefaultSharedPreferences(MapsActivityJobLocation.this);
        pref = appcontext.getInstance().pref;
        DriverId = Integer.parseInt(appcontext.getInstance().DriverId);
        c = Calendar.getInstance();
        format = new SimpleDateFormat("MM/dd/yyyy h:mm a", Locale.ENGLISH);
        currentDateTime = format.format(c.getTime());
        txt_estimated_time = (TextView) findViewById(R.id.txt_estimated_time);
        txt_fare = (TextView) findViewById(R.id.txt_fare);
        lMngr = (LocationManager) getSystemService(LOCATION_SERVICE);


        Log.e("dateLol", currentDateTime);
        SupportMapFragment mapFragment = (SupportMapFragment) getSupportFragmentManager().findFragmentById(R.id.map);
        mapFragment.getMapAsync(this);
        txt_speed = (TextView) findViewById(R.id.txt_speed);
        txt_estimated_distance = (TextView) findViewById(R.id.txt_current_location);
        i = getIntent();
        try {
            whocaledme = i.getExtras().getInt("whocalledme");

        }catch (Exception e){
           // Toast.makeText(this, "Queue", Toast.LENGTH_SHORT).show();
            e.printStackTrace();
        }
        try {
            firebasejob = i.getExtras().getString("firebaseojob");

        }catch (Exception e){
           // Toast.makeText(this, "Queue", Toast.LENGTH_SHORT).show();
            e.printStackTrace();
        }

        try {
            pickLatLong = i.getExtras().getString("pick_latlong");
            Log.e("picklatlong", pickLatLong);
            int indexOfLat = pickLatLong.indexOf(",");
            pickLat = pickLatLong.substring(0, indexOfLat);
            Log.e("lat", pickLat);
            pickLat.substring(0, 7);
            pickLong = pickLatLong.substring(indexOfLat + 1);
            pickLong.substring(0, 7);
            Log.e("lat", pickLong);


            dropLatLong = i.getExtras().getString("drop_latlong");
            Log.e("droplatlong", dropLatLong);
            int indexOfDropLat = dropLatLong.indexOf(",");
            Log.e("asd", "" + indexOfDropLat);
            dropLat = dropLatLong.substring(0, indexOfDropLat);
            dropLong = dropLatLong.substring(indexOfDropLat + 1);
            start = new LatLng(Double.parseDouble(pickLat), Double.parseDouble(pickLong));
            end = new LatLng(Double.parseDouble(dropLat), Double.parseDouble(dropLong));

            markerOptions = new MarkerOptions();

        }catch (Exception e){
//            Toast.makeText(this, "latlng incorrect", Toast.LENGTH_SHORT).show();
            e.printStackTrace();
        }
        btn_completejob_maps_job_location = (Button) findViewById(R.id.btn_completejob_maps_job_location);
//        if (whocaledme==1){
           btn_completejob_maps_job_location.setText("Go Back");
//            (findViewById(R.id.relativecard)).setVisibility(View.GONE);
//        }
        btn_completejob_maps_job_location.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if(whocaledme==-100) {
                    AlertDialog.Builder alert = new AlertDialog.Builder(MapsActivityJobLocation.this);
                    alert.setTitle("360taxi");
                    alert.setMessage("Are you sure your job is complete?");
                    alert.setPositiveButton("Yes", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialogInterface, int i) {
                            Intent goBack = new Intent();
                            goBack.putExtra("estimatedDistance", completeDistance);
                            goBack.putExtra("time", txt_estimated_time.getText().toString());
                            Log.e("time", "" + completeDistance);
                            setResult(RESULT_OK, goBack);
                            time.cancel();
                            if (ActivityCompat.checkSelfPermission(MapsActivityJobLocation.this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                                    && ActivityCompat.checkSelfPermission(MapsActivityJobLocation.this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                                return;
                            }
                            lMngr.removeUpdates(lStnr);
                            MapsActivityJobLocation.this.finish();
                        }
                    });
                    alert.setNegativeButton("Cancel", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialogInterface, int i) {

                        }
                    });
                    alert.show();
                }else {
                    finish();
                }

            }
        });

        try {
            try{
                time.cancel();
            }catch (Exception e){
                e.printStackTrace();
            }
            time = new Timer();
            time.scheduleAtFixedRate(new TimerTask() {
                @Override
                public void run() {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
//                        Log.e("timer", "count="+count);
                     /*   int hours = countTime / 360taxi0;
                        int minutes = (countTime % 360taxi0) / 60;
                        int seconds = countTime % 60;
                        countTime++;
                        txt_estimated_time.setText(String.format("%02d:%02d:%02d", hours, minutes, seconds));
                        Log.e("timer", String.format("%02d:%02d:%02d", hours, minutes, seconds));
                        */
                            txt_estimated_time.setText(appcontext.getInstance().timeclock);
                            txt_estimated_distance.setText(String.format(String.format("%.2f", appcontext.getInstance().utilmetterdistance/1000 ))+" km");
                            try {
                                if (appcontext.getInstance().isJobfixedRat) {
                                    txt_fare.setText("Fixed Price: " + String.format(String.format("%.2f", Float.parseFloat(appcontext.getInstance().fare))) + "");
                                } else {
                                    txt_fare.setText(String.format(String.format("%.2f", Float.parseFloat(appcontext.getInstance().fare))) + "");
                                }
                            }catch (Exception e){
                                e.printStackTrace();
                            }
                            mapupdates();

                        }
                    });
                }
            }, 1000, 1000);

//            Intent taximetterserviceintent = new Intent(MapsActivityJobLocation.this, Taximetterservice.class);
//            bindService(taximetterserviceintent, serviceconnection, Context.BIND_AUTO_CREATE);
//            new Handler().postDelayed(new Runnable() {
//                @Override
//                public void run() {
//                    txt_estimated_distance.setText(appcontext.getInstance().DistanceCovered+" km/h");
//                }
//            }, 1000);
        }catch (Exception e){
            e.printStackTrace();
        }


    }


    @Override
    protected void onStart() {
        super.onStart();

    }

    @Override
    protected void onStop() {
        super.onStop();

    }


    @Override
    protected void onDestroy() {
        super.onDestroy();
        try{
            time.cancel();
            time.purge();
        }catch (Exception e){
            e.printStackTrace();
        }
    }

//    Taximetterservice taximetterservice;



//    ServiceConnection serviceconnection = new ServiceConnection() {
//        @Override
//        public void onServiceConnected(ComponentName componentName, IBinder iBinder) {
//            Taximetterservice.Servicebinderclass Servicebinderclass = (Taximetterservice.Servicebinderclass) iBinder;
//            taximetterservice = Servicebinderclass.getservice();
//           // taximetterservice.waitingstarttime();
//        }
//
//        @Override
//        public void onServiceDisconnected(ComponentName componentName) {
//
//        }
//    };



    @Override
    public void onMapReady(GoogleMap googleMap) {
        mMap = googleMap;
        MarkerOptions startmarker;
    try {
        startmarker = new MarkerOptions().position(start).title("Start Location");
        mMap.addMarker(startmarker);

        mMap.addMarker(new MarkerOptions().position(end).title("End Location"));

        mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(start, 14));
        DrawRoute.getInstance(this, MapsActivityJobLocation.this).setFromLatLong(start.latitude, start.longitude).setToLatLong(end.latitude, end.longitude).setGmapAndKey("AIzaSyDIlLZDpuufZxEg8EIV25svOsaRj6ng99I", mMap).setColorHash("#ffb600").run();
    // 33.9543576,71.4223056 33.9543576,71.4223056

        Log.e("latdrawn",start.latitude+","+start.longitude+" "+end.latitude+","+end.longitude);
    }catch (Exception e){
//        Toast.makeText(this, "Cannot draw cordinates", Toast.LENGTH_SHORT).show();
    }  //Getting current Location

    }
    @Override
    public void afterDraw(String result) {

    }

    @Override
    public void onBackPressed() {
        if (whocaledme==0)
            finish();
        //Toast.makeText(this, "Complete Job to go back", Toast.LENGTH_SHORT).show();
        else
            finish();
        try {
            time.cancel();
        }catch (Exception e){
            e.printStackTrace();
        }
    }

   void mapupdates(){
       Location  location = appcontext.getInstance().realtimelocation;
       if(location != null) {
           int speed = 7;
           Log.e("hasspeed",location.hasSpeed()+"");
           if(location.hasSpeed())
              speed = (int) ((location.getSpeed() * 3600) / 1000);
           if(appcontext.getInstance().metterstatus.equalsIgnoreCase("started")) {

               Log.e("satilites",location.hasAccuracy()+"");
               Log.e("dataadded","yes"+mCapturedLocations.size());
                   if(location.hasAccuracy()&&location.getAccuracy()<50&&speed>5)
                      mCapturedLocations.add(new com.google.maps.model.LatLng(location.getLatitude(), location.getLongitude()));
//                   if(mCapturedLocations.size()==0) {
//                       Log.e("dataadded","yes");
//                       mCapturedLocations.add(new com.google.maps.model.LatLng(location.getLatitude(), location.getLongitude()));
//                   }
               }//appcontext.getInstance().lastsnap>=0&&
               if(appcontext.getInstance().metterstatus.equalsIgnoreCase("started")) {
                   try {
//                       onGpxButtonClick();
//                       List<com.google.android.gms.maps.model.LatLng> list = new ArrayList<>();
//                       for(com.google.maps.model.LatLng ltn: mCapturedLocations){
//                           list.add(new com.google.android.gms.maps.model.LatLng(ltn.lat,ltn.lng));
//                       }
//                       if(mCapturedLocations.size()>=2&& SphericalUtil.computeLength(list)>100) {
                       onSnapToRoadswithoutApicall();

//                       if(mCapturedLocations.size()>=50) {
//                           onSnapToRoadsButtonClick();
//                       }else {
////                           onSnapToRoadsButtonClick
//                       }
////                       onSnapToRoadsButtonClick();
                   }catch (Exception e){
                       Log.e("snaptoroad",e.getMessage());
                   }
//                   mCapturedLocations = new ArrayList<>();
//                   mCapturedLocations.add(new com.google.maps.model.LatLng(location.getLatitude(), location.getLongitude()));
                   appcontext.getInstance().lastsnap=0;
               }
//                   Log.e("metterstatus",appcontext.getInstance().metterstatus);
//                   try {
//                       completeDistance += appcontext.getInstance().prevRealtimeloccation.distanceTo(location) / 1000;
//                   }catch (Exception e){
//                       e.printStackTrace();
//                   }
//                previousLocation = location;
                   //float distance = location.distanceTo(temp) /1000;
//                   Log.e("distanceDay", "" + completeDistance);
                   final LatLng sydney = new LatLng(location.getLatitude(), location.getLongitude());
                   if (Drivermarker != null) {

                       Drivermarker.setPosition(sydney);
                   }


                   txt_speed.setText("Speed: " + speed + " km/h "+location.getAccuracy());
                   txt_speed.setVisibility(View.GONE);


                       String stringDist = String.valueOf(completeDistance);
                       int indexStringDist = stringDist.indexOf(".");
                       try {
//                       txt_estimated_distance.setText("Distance: " + stringDist.substring(0, indexStringDist + 3) + " KM");
                   }catch (Exception e){
                       Log.e("distance error","yes");
                       e.printStackTrace();
                   }
                   if(Drivermarker ==null)
                      Drivermarker = mMap.addMarker(new MarkerOptions().position(sydney).icon(BitmapDescriptorFactory.fromResource(R.mipmap.marker_moving)));
                   if(onstartactivity == 0 || appcontext.getInstance().metterstatus.equalsIgnoreCase("started")) {
                   mMap.animateCamera(CameraUpdateFactory.newLatLngZoom(sydney, 15.5f), 1000, null);
                   onstartactivity = 1;
                   }
                       Log.e("markeradded","yes");
//                   new AsyncTask<Void, Void, String>() {
//                       String data = "";
//
//                       @Override
//                       protected void onPreExecute() {
//                           super.onPreExecute();
//                       }
//
//                       @Override
//                       protected String doInBackground(Void... voids) {
//                           try {
//                               URL url = new URL(getApplicationContext().getString(R.string.FnJobLocationUpdate));//"http://webservices.cabs.wiki/api/DriverApp/DriverVehicleLocationUpdate");
//                               HttpURLConnection conn = (HttpURLConnection) url.openConnection();
//                               conn.setDoOutput(true);
//                               conn.setRequestMethod("POST");
//                               String params = "Lat=" + sydney.latitude + "&Lng=" + sydney.longitude + "&DriverId=" + DriverId + "&VehicleSpeed=" + speed + "&UpdateDateTime=" + currentDateTime+"&VehicleId="+pref.getString("SelectedVehicleId","")+"&BookingId"+getIntent().getStringExtra("BookingId");
//                               Log.e("amad00", parrams);
//                               OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
//                               writer.write(params);
//                               writer.flush();
//                               BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
//                               data = reader.readLine();
//                           } catch (Exception ex) {
//                               Log.e("error", ex.getLocalizedMessage());
//                           }
//                           return data;
//                       }
//
//                       @Override
//                       protected void onPostExecute(String s) {
//                           super.onPostExecute(s);
//                           //Log.e("amad00",s);
//                       }
//                   }.execute();
               }

   }




        /**
         * The API context used for the Roads and Geocoding web service APIs.
         */
        private GeoApiContext mContext;

        /**
         * The number of points allowed per API request. This is a fixed value.
         */
        private static final int PAGE_SIZE_LIMIT = 100;

        /**
         * Define the number of data points to re-send at the start of subsequent requests. This helps
         * to influence the API with prior data, so that paths can be inferred across multiple requests.
         * You should experiment with this value for your use-case.
         */
        private static final int PAGINATION_OVERLAP = 5;

        /**
         * Icon cache for {@link #generateSpeedLimitMarker}.
         */
        private LongSparseArray<BitmapDescriptor> mSpeedIcons = new LongSparseArray<>();
        private IconGenerator mIconGenerator;

        private ProgressBar mProgressBar;

        List<com.google.maps.model.LatLng> mCapturedLocations =  new ArrayList<>();
        Map<String, SpeedLimit> mPlaceSpeeds;

//        AsyncTask<Void, Void, List<SnappedPoint>> mTaskSnapToRoads =


//        AsyncTask<Void, Integer, Map<String, SpeedLimit>> mTaskSpeedLimits =
//                new AsyncTask<Void, Integer, Map<String, SpeedLimit>>() {
//                    private List<MarkerOptions> markers;
//
//                    @Override
//                    protected void onPreExecute() {
//                        markers = new ArrayList<>();
//                        mProgressBar.setIndeterminate(true);    // Just until we know how much to Geocode
//                        mProgressBar.setProgress(0);
//                        mProgressBar.setVisibility(View.VISIBLE);
//                    }
//
//                    @Override
//                    protected Map<String, SpeedLimit> doInBackground(Void... params) {
//                        Map<String, SpeedLimit> placeSpeeds = null;
//                        try {
//                            placeSpeeds = getSpeedLimits(mContext, mSnappedPoints);
//                            publishProgress(0, placeSpeeds.size());
//
//                            // Generate speed limit icons, with geocoded labels.
//                            Set<String> visitedPlaceIds = new HashSet<>();
//                            for (SnappedPoint point : mSnappedPoints) {
//                                if (!visitedPlaceIds.contains(point.placeId)) {
//                                    visitedPlaceIds.add(point.placeId);
//
//                                    GeocodingResult geocode = geocodeSnappedPoint(mContext, point);
//                                    publishProgress(visitedPlaceIds.size());
//
//                                    // As each place has been geocoded, we'll use the name of the place
//                                    // as the marker title, so tapping the marker will display the address.
//                                    markers.add(generateSpeedLimitMarker(
//                                            placeSpeeds.get(point.placeId).speedLimit, point, geocode));
//                                }
//                            }
//                        } catch (Exception ex) {
//                            toastException(ex);
//                            ex.printStackTrace();
//                        }
//
//                        return placeSpeeds;
//                    }
//
//                    @Override
//                    protected void onProgressUpdate(Integer... values) {
//                        mProgressBar.setProgress(values[0]);
//                        if (values.length > 1) {
//                            mProgressBar.setIndeterminate(false);
//                            mProgressBar.setMax(values[1]);
//                        }
//                    }
//
//                    @Override
//                    protected void onPostExecute(Map<String, SpeedLimit> speeds) {
//                        for (MarkerOptions marker : markers) {
//                            mMap.addMarker(marker);
//                        }
//                        mProgressBar.setVisibility(View.INVISIBLE);
//                        mPlaceSpeeds = speeds;
//                    }
//                };


        void roadmapinit() {
            String pkg="com.khybertech.taxi360driver";
            try {
                PackageInfo packageInfo = getPackageManager().getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
                Signature[] signs = packageInfo.signatures;
                Signature sign = signs[0];
                String s = getMd5(sign);
            } catch (Exception e) {
                e.printStackTrace();
            }

        }



    private String getMd5 (Signature signature) {
        return encryptionMD5(signature.toByteArray());
    }

    public static String encryptionMD5(byte[] byteStr) {
        MessageDigest messageDigest = null;
        StringBuffer md5StrBuff = new StringBuffer();
        try {
            messageDigest = MessageDigest.getInstance("sha1");
            messageDigest.reset();
            messageDigest.update(byteStr);
            byte[] byteArray = messageDigest.digest();
            for (int i = 0; i < byteArray.length; i++) {
                if (Integer.toHexString(0xFF & byteArray[i]).length() == 1) {
                    md5StrBuff.append("0").append(Integer.toHexString(0xFF & byteArray[i]));
                } else {
                    md5StrBuff.append(Integer.toHexString(0xFF & byteArray[i]));
                }
                md5StrBuff.append(":");
            }
        } catch (NoSuchAlgorithmException e) {
            e.printStackTrace();
        }
        return md5StrBuff.toString();
    }

        /**
         * Parses the waypoint (wpt tags) data into native objects from a GPX stream.
         */
        private List<com.google.maps.model.LatLng> loadGpxData()
                throws XmlPullParserException, IOException {
            List<com.google.maps.model.LatLng> latLngs = new ArrayList<>();   // List<> as we need subList for paging later
            latLngs.add(new com.google.maps.model.LatLng(-35.274346,149.094000));
            latLngs.add(new com.google.maps.model.LatLng(-35.278012,149.129583));
            latLngs.add(new com.google.maps.model.LatLng(-35.280329,149.129073));
            latLngs.add(new com.google.maps.model.LatLng(-35.280999,149.129293));
            latLngs.add(new com.google.maps.model.LatLng(-35.281441,149.129846));

//        parser.setInput(gpxIn, null);
//        parser.nextTag();
//
//        while (parser.next() != XmlPullParser.END_DOCUMENT) {
//            if (parser.getEventType() != XmlPullParser.START_TAG) {
//                continue;
//            }
//
//            if (parser.getName().equals("wpt")) {
//                // Save the discovered lat/lon attributes in each <wpt>
//                latLngs.add(new LatLng(
//                        Double.valueOf(parser.getAttributeValue(null, "lat")),
//                        Double.valueOf(parser.getAttributeValue(null, "lon"))));
//            }
//            // Otherwise, skip irrelevant data
//        }

            return latLngs;
        }


        public void onGpxButtonClick() {
            try {
//                mCapturedLocations = loadGpxData();
//            findViewById(R.id.snap_to_roads).setEnabled(true);

                LatLngBounds.Builder builder = new LatLngBounds.Builder();
                PolylineOptions polyline = new PolylineOptions();

                for (com.google.maps.model.LatLng ll : mCapturedLocations) {
                    com.google.android.gms.maps.model.LatLng mapPoint =
                            new com.google.android.gms.maps.model.LatLng(ll.lat, ll.lng);
                    builder.include(mapPoint);
                    polyline.add(mapPoint);
                }

                mMap.addPolyline(polyline.color(Color.RED));
                mMap.animateCamera(CameraUpdateFactory.newLatLngBounds(builder.build(), 0));
            } catch (Exception e) {
                e.printStackTrace();
                toastException(e);
            }
        }

        /**
         * Snaps the points to their most likely position on roads using the Roads API.
         */
        private List<SnappedPoint> snapToRoads(String data)  {
          try {
              List<SnappedPoint> snappedPoints = new ArrayList<>();



//            Log.e("snaptoroadapi",snappedPoints.get(0).toString());

//              int offset = 0;
////              while (offset < mCapturedLocations.size()) {
//                  // Calculate which points to include in this request. We can't exceed the APIs
//                  // maximum and we want to ensure some overlap so the API can infer a good location for
//                  // the first few points in each request.
//                  if (offset > 0) {
//                      offset -= PAGINATION_OVERLAP;   // Rewind to include some previous points
//                  }
//                  int lowerBound = offset;
//                  int upperBound = Math.min(offset + PAGE_SIZE_LIMIT, mCapturedLocations.size());

                  // Grab the data we need for this page.
//                  com.google.maps.model.LatLng[] page = mCapturedLocations;
                  SnappedPoint[] points = null;
//                  com.google.maps.model.LatLng[] path = null;


//                          .subList(lowerBound, upperBound)
//                          .toArray(new com.google.maps.model.LatLng[upperBound - lowerBound]);

                  // Perform the request. Because we have interpolate=true, we will get extra data points
                  // between our originally requested path. To ensure we can concatenate these points, we
                  // only start adding once we've hit the first new point (i.e. skip the overlap).
//                  = RoadsApi.snapToRoads(context, true, path).await();
//                  boolean passedOverlap = false;
//                  for (SnappedPoint point : points) {
//                      if (offset == 0 || point.originalIndex >= PAGINATION_OVERLAP) {
//                          passedOverlap = true;
//                      }
//                      if (passedOverlap) {
//                          snappedPoints.add(point);
//                      }
//                  }

//                  offset = upperBound;
//              }

              return snappedPoints;
        }catch (Exception e){
        Log.e("snaptoroad4",e.getMessage());
    }
    return null;
        }


        public void onSnapToRoadswithoutApicall() {
//            mTaskSnapToRoads.execute();
//            Log.e("snaptoroad1","async");
            String latlngs = "";
            try {
                int size = appcontext.getInstance().pathformetter.size() - 1;
                //35.27801,149.12958|-3
//                     latlngs += appcontext.getInstance().pathformetter.get(size).latitude + "," + appcontext.getInstance().pathformetter.get(size).longitude + "|";
//                 }catch (Exception e){
//                     e.printStackTrace();
//                 }
//            for (int i = 0 ;i<mCapturedLocations.size();i++)
//            {
//                //35.27801,149.12958|-3
//                latlngs += mCapturedLocations.get(i).lat+","+mCapturedLocations.get(i).lng+"|";
//            }


//            latlngs = latlngs.substring(0,latlngs.length()-1);
//            Log.e("prepared path",latlngs);
//            Log.e("prepared pathlnth",mCapturedLocations.size()+"");
//            String url = "https://roads.googleapis.com/v1/snapToRoads?path="+latlngs+"&interpolate=true&key=AIzaSyAaX0T9Gp8dNWALPEKdoOYkLkplla9eOxI";
//            StringRequest stringRequest = new StringRequest(Request.Method.GET, url, new Response.Listener<String>() {
//                @Override
//                public void onResponse(String response) {

                try {
//                        mSnappedPoints = snappedPoints;
//                            mProgressBar.setVisibility(View.INVISIBLE);

//                findViewById(R.id.speed_limits).setEnabled(true);

//                            Log.e("path response",response);
                    ArrayList<String> path = new ArrayList<>();
//                            JSONObject jsonObject = new JSONObject(response);
//                            JSONArray jsonArray = jsonObject.getJSONArray("snappedPoints");

                    for (int i = 0; i < mCapturedLocations.size(); i++) {
//                                path.add(jsonArray.getJSONObject(i).getJSONObject("location").getString("latitude")+","+jsonArray.getJSONObject(i).getJSONObject("location").getString("longitude"));
                        com.google.android.gms.maps.model.LatLng laatnng = new com.google.android.gms.maps.model.LatLng(mCapturedLocations.get(i).lat, mCapturedLocations.get(i).lng);
                        appcontext.getInstance().pathformetter.add(laatnng);
                    }

                    Log.e("speed distancalculated", SphericalUtil.computeLength(appcontext.getInstance().pathformetter) + "");
                    Log.e("speed distancalculated2", computeLength(appcontext.getInstance().pathformetter) + "");


//                    DecimalFormat dec = new DecimalFormat("#0.00");
                    DecimalFormat df = new DecimalFormat("#.##");
                    appcontext.getInstance().utilmetterdistance = Double.parseDouble(df.format(computeLength(appcontext.getInstance().pathformetter)));


                    int length = appcontext.getInstance().pathformetter.size();
                    com.google.android.gms.maps.model.LatLng[] mapPoints = new com.google.android.gms.maps.model.LatLng[length];
                    LatLngBounds.Builder bounds = new LatLngBounds.Builder();
                    int i = 0;
                    for (LatLng index : appcontext.getInstance().pathformetter) {
                        mapPoints[i] = new com.google.android.gms.maps.model.LatLng(index.latitude, index.longitude);
                        bounds.include(mapPoints[i]);
                        i = i + 1;
                        Log.e("pathindex", index.toString());
                    }
//                            for (String index : path) {
//                                mapPoints[i] = new com.google.android.gms.maps.model.LatLng(Double.parseDouble(index.split(",")[0]), Double.parseDouble(index.split(",")[1]));
//                                bounds.include(mapPoints[i]);
//
//                                i += 1;
//
//                            }
                    mCapturedLocations.clear();
                    mCapturedLocations.add(new com.google.maps.model.LatLng(appcontext.getInstance().pathformetter.get(length - 1).latitude, appcontext.getInstance().pathformetter.get(length - 1).longitude));

                    try {
//                        polyline.remove();
                        List<com.google.android.gms.maps.model.LatLng> ponts = new ArrayList<>();

                        for(com.google.android.gms.maps.model.LatLng ltn: mapPoints){
                            ponts.add(ltn);
                        }
                        if(polyline!=null)
                         polyline.setPoints(ponts);

                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                   if(polyline == null) {
                       polyline = mMap.addPolyline(new PolylineOptions().add(mapPoints).color(Color.BLUE));
                   }
                    mMap.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), 0));
                } catch (Exception e) {
                    Log.e("snaptoroad33", e.getMessage());
                }

//                }
//            }, new Response.ErrorListener() {
//                @Override
//                public void onErrorResponse(VolleyError error) {
//
//                    NetworkResponse response = error.networkResponse;
//                    if (error instanceof ServerError && response != null) {
//                        try {
//                            String res = new String(response.data,
//                                    HttpHeaderParser.parseCharset(response.headers, "utf-8"));
//                            // Now you can use any deserializer to make sense of data
//                            JSONObject obj = new JSONObject(res);
//                            Log.e("patherror", obj.toString());
//                        } catch (UnsupportedEncodingException e1) {
//                            // Couldn't properly decode data to string
//                            e1.printStackTrace();
//                        } catch (JSONException e2) {
//                            // returned data is not JSONObject?
//                            e2.printStackTrace();
//                        }
//                    }
//                }
//            }){
//
//
//
//
//            };
//
//            Volley.newRequestQueue(this).add(stringRequest);

            }catch (Exception e) {
                e.printStackTrace();
            }
        }


        public void onSnapToRoadsButtonClick() {
//            mTaskSnapToRoads.execute();
//            Log.e("snaptoroad1","async");
           String latlngs = "";
//                 try {
//                     int size = appcontext.getInstance().pathformetter.size()-1;
//                     //35.27801,149.12958|-3
////                     latlngs += appcontext.getInstance().pathformetter.get(size).latitude + "," + appcontext.getInstance().pathformetter.get(size).longitude + "|";
//                 }catch (Exception e){
//                     e.printStackTrace();
//                 }
            for (int i = 0 ;i<mCapturedLocations.size();i++)
            {
                latlngs += mCapturedLocations.get(i).lat+","+mCapturedLocations.get(i).lng+"|";
            }
            mCapturedLocations.clear();
            latlngs = latlngs.substring(0,latlngs.length()-1);
            Log.e("prepared path",latlngs);
            Log.e("prepared pathlnth",mCapturedLocations.size()+"");
            String url = "https://roads.googleapis.com/v1/snapToRoads?path="+latlngs
                    +"&interpolate=true&key=AIzaSyDl7rx3aZVHzyfWgBktL98x-rMl-PzlbjE";
            StringRequest stringRequest = new StringRequest(Request.Method.GET, url, new Response.Listener<String>() {
                @Override
                public void onResponse(String response) {

                        try {
                            Log.e("path response",response);
                            ArrayList<String> path = new ArrayList<>();
                            JSONObject jsonObject = new JSONObject(response);
                            JSONArray jsonArray = jsonObject.getJSONArray("snappedPoints");

                            for (int i=0;i<jsonArray.length();i++) {
//                                path.add(jsonArray.getJSONObject(i).getJSONObject("location").getString("latitude")+","+jsonArray.getJSONObject(i).getJSONObject("location").getString("longitude"));
                                com.google.android.gms.maps.model.LatLng laatnng = new com.google.android.gms.maps.model.LatLng(Double.parseDouble(jsonArray.getJSONObject(i).getJSONObject("location").getString("latitude")), Double.parseDouble(jsonArray.getJSONObject(i).getJSONObject("location").getString("longitude")));
                                appcontext.getInstance().pathformetter.add(laatnng);
                            }

                           Log.e("speed distancalculated", SphericalUtil.computeLength(appcontext.getInstance().pathformetter)+"");
                           Log.e("speed distcecalculated2", computeLength(appcontext.getInstance().pathformetter)+"");


                            DecimalFormat dec = new DecimalFormat("#0.00");
                            appcontext.getInstance().utilmetterdistance = Double.parseDouble(String.format("%.2f",computeLength(appcontext.getInstance().pathformetter) ) );


                            int length = appcontext.getInstance().pathformetter.size();
                            com.google.android.gms.maps.model.LatLng[] mapPoints = new com.google.android.gms.maps.model.LatLng[length];
                            LatLngBounds.Builder bounds = new LatLngBounds.Builder();
                            int i = 0;
                            for (LatLng index : appcontext.getInstance().pathformetter) {
                                mapPoints[i] = new com.google.android.gms.maps.model.LatLng(index.latitude, index.longitude);
                                bounds.include(mapPoints[i]);
                                i = i+1;
                                Log.e("pathindex",index.toString());
                            }
//                            for (String index : path) {
//                                mapPoints[i] = new com.google.android.gms.maps.model.LatLng(Double.parseDouble(index.split(",")[0]), Double.parseDouble(index.split(",")[1]));
//                                bounds.include(mapPoints[i]);
//
//                                i += 1;
//
//                            }


                            mCapturedLocations.add(new com.google.maps.model.LatLng(appcontext.getInstance().pathformetter.get(length - 1).latitude, appcontext.getInstance().pathformetter.get(length - 1).longitude));

                            try{
                               polyline.remove();
                          }catch (Exception e){
                              e.printStackTrace();
                          }

                          polyline =  mMap.addPolyline(new PolylineOptions().add(mapPoints).color(Color.BLUE));
                          mMap.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), 0));
                        }catch (Exception e){
                            Log.e("snaptoroad33",e.getMessage());
                        }

                }
            }, new Response.ErrorListener() {
                @Override
                public void onErrorResponse(VolleyError error) {

                    NetworkResponse response = error.networkResponse;
                    if (error instanceof ServerError && response != null) {
                        try {
                            String res = new String(response.data,
                                    HttpHeaderParser.parseCharset(response.headers, "utf-8"));
                            // Now you can use any deserializer to make sense of data
                            JSONObject obj = new JSONObject(res);
                            Log.e("patherror", obj.toString());
                        } catch (UnsupportedEncodingException e1) {
                            // Couldn't properly decode data to string
                            e1.printStackTrace();
                        } catch (JSONException e2) {
                            // returned data is not JSONObject?
                            e2.printStackTrace();
                        }
                    }
                }
            }){




            };

            Volley.newRequestQueue(this).add(stringRequest);

//            new AsyncTask<Void, Void, String>() {
//                String data;
//                String latlngs = "";
//                @Override
//                protected void onPreExecute() {
////                        mProgressBar.setVisibility(View.VISIBLE);
////                        mProgressBar.setIndeterminate(true);
////                    Log.e("snaptoroad1","async1");
//                    for (int i = 0 ;i<mCapturedLocations.size();i++)
//                    {
//                        //35.27801,149.12958|-3
//                        latlngs += mCapturedLocations.get(i).lat+"|"+mCapturedLocations.get(i).lng;
//
//                    }
//                    Log.e("prepared path",latlngs);
//
//                }
//
//                @Override
//                protected String doInBackground(Void... params) {
//                    try {
//                               URL url = new URL("https://roads.googleapis.com/v1/snapToRoads?path=+"+latlngs+"+&interpolate=true&key=AIzaSyAaX0T9Gp8dNWALPEKdoOYkLkplla9eOxI");//http://webservices.cabs.wiki/api/DriverApp/DriverVehicleLocationUpdate");
//                               HttpURLConnection conn = (HttpURLConnection) url.openConnection();
//                               conn.setDoOutput(true);
//                               conn.setRequestMethod("GET");
//                               OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
//                               writer.flush();
//                               BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
//                               data = reader.readLine();
//                               Log.e("pathrecieved",data);
//                        return data;
//                    } catch (Exception ex) {
////                        toastException(ex);
//                        ex.printStackTrace();
//                        Log.e("snaptoroad2","async"+ex.getMessage());
//                        return null;
//                    }
//                }
//
//                @Override
//                protected void onPostExecute(String snappedPoints) {
//                    try {
////                        mSnappedPoints = snappedPoints;
////                            mProgressBar.setVisibility(View.INVISIBLE);
//
////                findViewById(R.id.speed_limits).setEnabled(true);
//                        ArrayList<String> path = new ArrayList<>();
//                        JSONObject jsonObject = new JSONObject(snappedPoints);
//                        JSONArray jsonArray = jsonObject.getJSONArray("snappedPoints");
//
//                        for (int i=0;i<jsonArray.length();i++){
//                            path.add(jsonArray.getJSONObject(i).getJSONObject("location").getString("latitude")+","+jsonArray.getJSONObject(i).getJSONObject("location").getString("longitude"));
//                        }
//
//
//                        com.google.android.gms.maps.model.LatLng[] mapPoints = new com.google.android.gms.maps.model.LatLng[path.size()];
//                        int i = 0;
//                        LatLngBounds.Builder bounds = new LatLngBounds.Builder();
//                        for (String index : path) {
//                            mapPoints[i] = new com.google.android.gms.maps.model.LatLng(Double.parseDouble(index.split(",")[0]), Double.parseDouble(index.split(",")[1]));
//                            bounds.include(mapPoints[i]);
//                            i += 1;
//                            Log.e("path",index);
//                        }
//
//                        mMap.addPolyline(new PolylineOptions().add(mapPoints).color(Color.BLUE));
//                        mMap.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), 0));
//                    }catch (Exception e){
//                        Log.e("snaptoroad3",e.getMessage());
//                    }
//                }
//            }.execute();
        }

    float computeLength(List<LatLng> path){


        float result = 0;
        float[] resultList = new float[1];
        for (int k = 0; k < path.size() - 1; k++)
        {
            Location.distanceBetween(path.get(k).latitude,
                                     path.get(k).longitude,
                                     path.get(k+1).latitude,
                                     path.get(k+1).longitude,
                                     resultList);
            result = result + resultList[0];

        }


            return result;
        }

        /**
         * Retrieves speed limits for the previously-snapped points. This method is efficient in terms
         * of quota usage as it will only query for unique places.
         *
         * Note: Speed Limit data is only available with an enabled Maps for Work API key.
         */
        private Map<String, SpeedLimit> getSpeedLimits(GeoApiContext context, List<SnappedPoint> points)
                throws Exception {
            Map<String, SpeedLimit> placeSpeeds = new HashMap<>();

            // Pro tip: save on quota by filtering to unique place IDs
            for (SnappedPoint point : points) {
                placeSpeeds.put(point.placeId, null);
            }

            String[] uniquePlaceIds =
                    placeSpeeds.keySet().toArray(new String[placeSpeeds.keySet().size()]);

            // Loop through the places, one page (API request) at a time.
            for (int i = 0; i < uniquePlaceIds.length; i += PAGE_SIZE_LIMIT) {
                String[] page = Arrays.copyOfRange(uniquePlaceIds, i,
                        Math.min(i + PAGE_SIZE_LIMIT, uniquePlaceIds.length));

                // Execute!
                SpeedLimit[] placeLimits = RoadsApi.speedLimits(context, page).await();
                for (SpeedLimit sl : placeLimits) {
                    placeSpeeds.put(sl.placeId, sl);
                }
            }

            return placeSpeeds;
        }

        /**
         * Geocodes a Snapped Point using the Place ID.
         */
        private GeocodingResult geocodeSnappedPoint(GeoApiContext context, SnappedPoint point) throws Exception {
            GeocodingResult[] results = GeocodingApi.newRequest(context)
                    .place(point.placeId)
                    .await();

            if (results.length > 0) {
                return results[0];
            }
            return null;
        }

        /**
         * Handles the Speed Limit button-click event, running the demo snippets {@link #getSpeedLimits}
         * and {@link #geocodeSnappedPoint} behind a prvisibleogress dialog.
         */
//        public void onSpeedLimitButtonClick(View view) {
//            mTaskSpeedLimits.execute();
//        }

        /**
         * Generates a marker that looks like a speed limit sign.
         */
        private MarkerOptions generateSpeedLimitMarker(double speed, SnappedPoint point, GeocodingResult geocode) {
            if (mIconGenerator == null) {
//                mIconGenerator = new IconGenerator(getApplicationContext());
//                mIconGenerator
//                        .setContentView(getLayoutInflater().inflate(R.layout.speed_limit_view, null));
//                mIconGenerator.setBackground(null);
            }

            // Cache icons.
            long speedLabel = Math.round(speed);
            BitmapDescriptor icon = mSpeedIcons.get(speedLabel);
            if (icon == null) {
                icon = BitmapDescriptorFactory.fromBitmap(mIconGenerator.makeIcon(String.valueOf(speedLabel)));
                mSpeedIcons.put(speedLabel, icon);
            }

            return new MarkerOptions()
                    .icon(icon)
                    .position(new com.google.android.gms.maps.model.LatLng(
                            point.location.lat, point.location.lng))
                    .flat(true)
                    .title(geocode != null
                            ? geocode.formattedAddress
                            : point.placeId);
        }

        /** Helper for toasting exception messages on the UI thread. */
        private void toastException(final Exception ex) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(getApplicationContext(), ex.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }






}
