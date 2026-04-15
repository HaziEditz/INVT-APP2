package com.khybertech.taxi360driver.Maps;

import android.Manifest;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationManager;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.preference.PreferenceManager;
import android.support.v4.app.ActivityCompat;
import android.support.v4.app.FragmentActivity;
import android.support.v7.widget.Toolbar;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.animation.Animation;
import android.view.animation.AnimationUtils;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import com.khybertech.taxi360driver.R;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.GooglePlayServicesNotAvailableException;
import com.google.android.gms.common.GooglePlayServicesRepairableException;
import com.google.android.gms.common.api.Status;
import com.google.android.gms.location.places.Place;
import com.google.android.gms.location.places.ui.PlaceAutocomplete;
import com.google.android.gms.location.places.ui.PlaceAutocompleteFragment;
import com.google.android.gms.location.places.ui.PlaceSelectionListener;
import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.SupportMapFragment;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;

import java.io.IOException;
import java.util.List;
import java.util.Locale;

public class DestinationActivity extends FragmentActivity implements OnMapReadyCallback {

    private GoogleMap mMap;
    Toolbar toolbar_Destination;
    Marker m;
    ImageView iv_marker;
    Geocoder geocoder;
    int i = 0;
    SupportMapFragment mapFragment;
    SupportMapFragment frg;
    Button btn_drop_dest,button_current_location_destination;
    EditText etxt_dropLoc;
    SharedPreferences sharedPreferences;
    SharedPreferences.Editor editor;
    LocationManager lmngr;
    Location loc_picup = null;
    PlaceAutocompleteFragment autocomplete_drop_location;
    String placeName = "";
    String locationNameToBeSent = "";
    LatLng placeLatLng = null;
    LatLng locationToBeSent = null;
    int count = 0;
    ProgressDialog pd_main;


    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_destination);
        sharedPreferences = PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
        editor = sharedPreferences.edit();
        // Obtain the SupportMapFragment and get notified when the map is ready to be used.
        /*mapFraggment = (SupportMapFragment) getSupportFragmentManager()
                .findFragmentById(R.id.map);*/
        frg = (SupportMapFragment) getSupportFragmentManager().findFragmentById(R.id.map);
        frg.getMapAsync(this);
        //mapFragment.getMapAsync(this);

        Button distsearchcard = (Button)findViewById(R.id.searchbtn);

        distsearchcard.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {

             /*   String query = "peshawar";

               LatLngBounds latLngBounds = LatLngBounds.Builder.class;

               PendingResult<AutocompletePredictionBuffer> result =
                       Places.GeoDataApi.getAutocompletePredictions(mGoogleApiClient, query,
                                latLngBounds, null);

                result.setResultCallback(MapsActivity.this);

             */
                try {
                    // The autocomplete activity requires Google Play Services to be available. The intent
                    // builder checks this and throws an exception if it is not the case.


                    Intent intent = new PlaceAutocomplete.IntentBuilder(PlaceAutocomplete.MODE_OVERLAY).build(DestinationActivity.this);
                    startActivityForResult(intent, 111);
                } catch (GooglePlayServicesRepairableException e) {
                    // Indicates that Google Play Services is either not installed or not up to date. Prompt
                    // the user to correct the issue.
                    GoogleApiAvailability.getInstance().getErrorDialog(DestinationActivity.this, e.getConnectionStatusCode(),
                            0 /* requestCode */).show();
                } catch (GooglePlayServicesNotAvailableException e) {
                    // Indicates that Google Play Services is not available and the problem is not easily
                    // resolvable.
                    String message = "Google Play Services is not available: " +
                            GoogleApiAvailability.getInstance().getErrorString(e.errorCode);

                    Log.e("autocompletecustom: ", message);
                    Toast.makeText(DestinationActivity.this, message, Toast.LENGTH_SHORT).show();
                }


            }


    });


        widgets();
        toolbarMethod();
        //pd_main = ProgressDialog.show(DestinationActivity.this,"CabsWiki","Please Wait",false,false);
        lmngr = (LocationManager)getSystemService(LOCATION_SERVICE);
        btn_drop_dest.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent result = new Intent();
                result.putExtra("loc_name",locationNameToBeSent);
                result.putExtra("loc_latlng",locationToBeSent);
                double d = locationToBeSent.latitude;
                Log.e("sentLoc",""+locationToBeSent);
                Log.e("sentLoc",""+d);
                setResult(RESULT_OK,result);
                DestinationActivity.this.finish();
            }
        });
        button_current_location_destination.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (ActivityCompat.checkSelfPermission(DestinationActivity.this, Manifest.permission.ACCESS_FINE_LOCATION)
                        != PackageManager.PERMISSION_GRANTED &&
                        ActivityCompat.checkSelfPermission(DestinationActivity.this, Manifest.permission.ACCESS_COARSE_LOCATION)
                                != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(DestinationActivity.this,new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},01);
                    return;
                }
                // cached gps signals
                Location lastKnownLocation = lmngr.getLastKnownLocation(lmngr.NETWORK_PROVIDER);

                if (lastKnownLocation != null) {
                    LatLng loc = new LatLng(lastKnownLocation.getLatitude(), lastKnownLocation.getLongitude());
                    mMap.animateCamera(CameraUpdateFactory.newLatLngZoom(loc,17f),400,null);
                }


                lmngr.requestLocationUpdates(lmngr.NETWORK_PROVIDER, 0, 0, new android.location.LocationListener() {
                    @Override
                    public void onLocationChanged(Location location) {
                        loc_picup = location;
                    }

                    @Override
                    public void onStatusChanged(String s, int i, Bundle bundle) {

                    }

                    @Override
                    public void onProviderEnabled(String s) {

                    }

                    @Override
                    public void onProviderDisabled(String s) {

                    }
                });

               // final ProgressDialog pd = ProgressDialog.show(DestinationActivity.this,"CabsWiki","Locating...",false,false);
                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (loc_picup != null){
                            LatLng loc = new LatLng(loc_picup.getLatitude(), loc_picup.getLongitude());
                            mMap.animateCamera(CameraUpdateFactory.newLatLngZoom(loc,16f));
                         //   mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(loc_picup.getLatitude(),loc_picup.getLongitude()),16f));
                         //   mMap.addMarker(new MarkerOptions().position(new LatLng(loc_picup.getLatitude(),loc_picup.getLongitude())));
                        }
                        else {
                            Toast.makeText(DestinationActivity.this, "Retry or check GPS", Toast.LENGTH_SHORT).show();
                        }
                      //  pd.dismiss();
                    }
                }, 3000);
                Log.e("loca",""+loc_picup);
            }
        });
        etxt_dropLoc.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_SEARCH){
                    String data = etxt_dropLoc.getText().toString();
                    if (data.equalsIgnoreCase("Searching...")){
                        Toast.makeText(DestinationActivity.this, "Enter Valid Address", Toast.LENGTH_SHORT).show();
                    }
                    else if (data.equalsIgnoreCase("null")){
                        Toast.makeText(DestinationActivity.this, "Enter Valid Address", Toast.LENGTH_SHORT).show();
                    }
                    else if (data.equalsIgnoreCase("")){
                        Toast.makeText(DestinationActivity.this, "Enter Valid Address", Toast.LENGTH_SHORT).show();
                    }
                    else {
                        try {
                            List<Address> addr_name = geocoder.getFromLocationName(data, 1);
                            double lat = addr_name.get(0).getLatitude();
                            double lng = addr_name.get(0).getLongitude();
                            LatLng dest = new LatLng(lat,lng);
                            mMap.addMarker(new MarkerOptions().position(dest).title(addr_name.get(0).getAddressLine(0).replace("null","")));
                            mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(dest,16f));
                            Log.e("location_check",""+addr_name);
                        }
                        catch (Exception ex){

                        }
                    }
                    return true;
                }
                return false;
            }
        });

        //Autocomplete Fragment
        autocomplete_drop_location.setOnPlaceSelectedListener(new PlaceSelectionListener() {
            @Override
            public void onPlaceSelected(Place place) {
                onplaceselectmanual(place);
                placeName = ""+place.getName()+" "+place.getAddress().toString().replace(place.getName().toString(), "");
                locationNameToBeSent = placeName;
                placeLatLng = place.getLatLng();
                locationToBeSent = placeLatLng;
                mMap.addMarker(new MarkerOptions().position(placeLatLng).title(placeName));
                mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(placeLatLng,17f));
                etxt_dropLoc.setText(placeName);
                editor.putString("drop_dest_status", "1");
                editor.putString("dropLat", "" + placeLatLng.latitude);
                editor.putString("dropLng",""+placeLatLng.longitude);
                editor.putString("dropLoc",  etxt_dropLoc.getText().toString());
            }

            @Override
            public void onError(Status status) {
                Log.e("place", "error: "+status);
            }
        });


    }

    @Override
    public void onMapReady(GoogleMap googleMap) {
        mMap = googleMap;
        geocoder = new Geocoder(this, Locale.getDefault());
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(DestinationActivity.this, new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},1);
            return;
        }
        mMap.getUiSettings().setTiltGesturesEnabled(false);
        mMap.getUiSettings().setCompassEnabled(false);
        //  mMap.getUiSettings().setIndoorLevelPickerEnabled(false);
        //  mMap.setBuildingsEnabled(false);



        // cached gps signals
        Location lastKnownLocation = lmngr.getLastKnownLocation(lmngr.NETWORK_PROVIDER);

        if (lastKnownLocation != null) {
            LatLng loc = new LatLng(lastKnownLocation.getLatitude(), lastKnownLocation.getLongitude());
            mMap.animateCamera(CameraUpdateFactory.newLatLngZoom(loc,17f),400,null);
        }








        lmngr.requestLocationUpdates(lmngr.NETWORK_PROVIDER, 0, 0, new android.location.LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                if (count == 0){
                    LatLng loc = new LatLng(location.getLatitude(), location.getLongitude());
                    mMap.animateCamera(CameraUpdateFactory.newLatLngZoom(loc,16f));
                  //  pd_main.dismiss();
                    count++;
                }
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {

            }

            @Override
            public void onProviderEnabled(String provider) {

            }

            @Override
            public void onProviderDisabled(String provider) {

            }
        });

        mMap.setOnCameraMoveStartedListener(new GoogleMap.OnCameraMoveStartedListener() {
            @Override
            public void onCameraMoveStarted(int i) {
                // mMap.clear();
                Animation logoMoveAnimation = AnimationUtils.loadAnimation(DestinationActivity.this, R.anim.bounce);
                iv_marker.startAnimation(logoMoveAnimation);

                //  iv_marker.setVisibility(View.INVISIBLE);
            }
        });


        mMap.setOnCameraMoveListener(new GoogleMap.OnCameraMoveListener() {
            @Override
            public void onCameraMove() {
            }
        });

        mMap.setOnCameraIdleListener(new GoogleMap.OnCameraIdleListener() {
            @Override
            public void onCameraIdle() {
                // mMap.clear();


                //  iv_marker.setVisibility(View.VISIBLE);
                //   Toast.makeText(MapsActivity.this, "latlong: "+ mMap.getCameraPosition().target.longitude+" "+mMap.getCameraPosition().target.latitude, Toast.LENGTH_SHORT).show();
                final Location location = new Location(lmngr.NETWORK_PROVIDER);
                location.setLatitude(mMap.getCameraPosition().target.latitude);
                location.setLongitude(mMap.getCameraPosition().target.longitude);
                new DestinationActivity.AsyncGeocoder().execute(new DestinationActivity.AsyncGeocoderObject(
                        new Geocoder(DestinationActivity.this),
                        location,
                        etxt_dropLoc
                ));


               /* iv_marker.setVisibility(View.GONE);
                try {
                    List<Address> ls = geocoder.getFromLocation(mMap.getCameraPosition().target.latitude, mMap.getCameraPosition().target.longitude, 5);
                    for (int i = 0; i < ls.size(); i++) {
                        if (ls.size() > 0 && ls.get(0).getAddressLine(0) != null && ls.get(0).getAddressLine(1) != null && ls.get(0).getAddressLine(2) != null) {
                            Log.e("majidKhan", ls.get(0).getAddressLine(0));
                            Log.e("majidKhan", ls.get(0).getAddressLine(1));
                            Log.e("majidKhan", ls.get(0).getAddressLine(2));
                            String address = ls.get(0).getAddressLine(0) + " " + ls.get(0).getAddressLine(1) + " " + ls.get(0).getAddressLine(2);
                            etxt_pickLoc.setText(address.replace("null", ""));
                            editor.putString("pick_loc_status", "1");
                            editor.putString("pickLat", "" + mMap.getCameraPosition().target.latitude);
                            editor.putString("pickLng",""+mMap.getCameraPosition().target.longitude);
                            editor.putString("pickLoc", etxt_pickLoc.getText().toString());

                    }
                } catch (IOException e) {
                    e.printStackTrace();
                }*/
            }
        });
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        return super.onTouchEvent(event);
    }

    public void toolbarMethod(){
        toolbar_Destination.setTitle("Destination");
        //toolbar_Destination.setNavigationIcon(R.mipmap.nav_back);
        toolbar_Destination.setNavigationOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
             //   Intent i = new Intent(DestinationActivity.this, MakeABooking.class);
            //    startActivity(i);
                DestinationActivity.this.finish();
            }
        });
    }

    public void widgets(){
        toolbar_Destination= (Toolbar) findViewById(R.id.toolbar_DestinationActivity);
        iv_marker = (ImageView) findViewById(R.id.iv_marker_destinationActivity);
        btn_drop_dest= (Button) findViewById(R.id.btn_drop_DestinationActivity);
        etxt_dropLoc= (EditText) findViewById(R.id.etxt_drop_destinationActivity);
        button_current_location_destination = (Button) findViewById(R.id.button_current_location_destination);
        autocomplete_drop_location = (PlaceAutocompleteFragment) getFragmentManager().findFragmentById(R.id.autocomplete_drop_location);
    }


    public class AsyncGeocoderObject {

        public Location location; // location to get address from
        Geocoder geocoder; // the geocoder
        TextView textView; // textview to update text

        public AsyncGeocoderObject(Geocoder geocoder, Location location, TextView textView) {
            this.geocoder = geocoder;
            this.location = location;
            this.textView = textView;
        }
    }


    public class AsyncGeocoder extends AsyncTask<AsyncGeocoderObject, Void, List<Address>> {

        private TextView textView;

        @Override
        protected List<Address> doInBackground(DestinationActivity.AsyncGeocoderObject... asyncGeocoderObjects) {
            List<Address> addresses = null;
            DestinationActivity.AsyncGeocoderObject asyncGeocoderObject = asyncGeocoderObjects[0];
            textView = asyncGeocoderObject.textView;
            try {
                addresses = asyncGeocoderObject.geocoder.getFromLocation(asyncGeocoderObject.location.getLatitude(),
                        asyncGeocoderObject.location.getLongitude(),5);
            } catch (IOException e) {
                e.printStackTrace();
            }
            return addresses;
        }

        @Override
        protected void onPostExecute(List<Address> ls) {
            try {
                Log.v("onPostExecute", "location: " + ls);
                String address;
                if (ls.size() > 0 && ls.get(0).getAddressLine(0) != null && ls.get(0).getAddressLine(1) != null && ls.get(0).getAddressLine(2) != null) {
                    address = ls.get(0).getAddressLine(0) + " " + ls.get(0).getAddressLine(1) + " " + ls.get(0).getAddressLine(2);
                    editor.putString("drop_dest_status", "1");
                    editor.putString("dropLat", "" + mMap.getCameraPosition().target.latitude);
                    editor.putString("dropLng", "" + mMap.getCameraPosition().target.longitude);
                    editor.putString("dropLoc", address);//etxt_dropLoc.getText().toString());
                    locationNameToBeSent = address;
                    locationToBeSent = new LatLng(mMap.getCameraPosition().target.latitude,  mMap.getCameraPosition().target.longitude);


                    textView.setText(address.replace("null", ""));
                }
            }catch (Exception e){

                Log.d("diseditor",e.getMessage());
            }

        }

    }
    public void onplaceselectmanual(Place place) {
        placeName = ""+place.getName()+" "+place.getAddress().toString().replace(place.getName().toString(), "");
        locationNameToBeSent = placeName;
        placeLatLng = place.getLatLng();
        locationToBeSent = placeLatLng;
        //mMap.addMarker(new MarkerOptions().position(placeLatLng).title(placeName));
        mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(placeLatLng,17f));
        etxt_dropLoc.setText(placeName);

        editor.putString("drop_dest_status", "1");
        editor.putString("dropLat", "" + placeLatLng.latitude);
        editor.putString("dropLng",""+placeLatLng.longitude);
        editor.putString("dropLoc", etxt_dropLoc.getText().toString());

    }


    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        // Check that the result was from the autocomplete widget.
        if (requestCode == 111) {
            if (resultCode == RESULT_OK) {
                // Get the user's selected place from the Intent.
                Place place = PlaceAutocomplete.getPlace(this, data);
                onplaceselectmanual(place);


            } else if (resultCode == PlaceAutocomplete.RESULT_ERROR) {
                Status status = PlaceAutocomplete.getStatus(this, data);
                Log.e("custome search: ", "Error: Status = " + status.toString());
            } else if (resultCode == RESULT_CANCELED) {
                // Indicates that the activity closed before a selection was made. For example if
                // the user pressed the back button.
            }
        }
    }

}
