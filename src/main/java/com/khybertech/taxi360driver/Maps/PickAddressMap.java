package com.khybertech.taxi360driver.Maps;

import android.Manifest;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;
import android.preference.PreferenceManager;
import android.support.annotation.NonNull;
import android.support.v4.app.ActivityCompat;
import android.support.v4.app.FragmentActivity;
import android.os.Bundle;
import android.support.v4.content.ContextCompat;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Toast;

import com.khybertech.taxi360driver.R;
import com.google.android.gms.common.api.Status;
import com.google.android.gms.location.places.Place;
import com.google.android.gms.location.places.ui.PlaceAutocompleteFragment;
import com.google.android.gms.location.places.ui.PlaceSelectionListener;
import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.SupportMapFragment;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;

import java.io.IOException;
import java.util.List;
import java.util.Locale;

public class PickAddressMap extends FragmentActivity implements OnMapReadyCallback {

    private GoogleMap mMap;
    SupportMapFragment frg;
    ImageView iv_marker;
    Geocoder geocoder;
    EditText etxt_showloc_pickaddr;
    ImageView iv_mylocation_pickaddress;
    Button btn_pickup;
    LocationManager lmngr;
    Location loc_picup = null;
    SharedPreferences pref;
    SharedPreferences.Editor edit;
    LinearLayout pickup_overlay;
    int permissionCheckCoarseLoc;
    PlaceAutocompleteFragment autocompleteFragment;
    String locationNameToBeSent;
    LatLng locationToBeSent = null;
    int count;
    Marker m;
    ProgressDialog pd_main;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_pick_address_map);
        frg = (SupportMapFragment) getSupportFragmentManager().findFragmentById(R.id.map);
        frg.getMapAsync(this);
        iv_marker = (ImageView) findViewById(R.id.iv_marker);
        etxt_showloc_pickaddr = (EditText) findViewById(R.id.etxt_showloc_pickaddr);
        iv_mylocation_pickaddress = (ImageView) findViewById(R.id.iv_mylocation_pickaddress);
        autocompleteFragment = (PlaceAutocompleteFragment) getFragmentManager().findFragmentById(R.id.autocomplete_pickup_location);
        btn_pickup = (Button) findViewById(R.id.btn_pickup);
        pickup_overlay = (LinearLayout) findViewById(R.id.pickup_overlay);
        pref = PreferenceManager.getDefaultSharedPreferences(PickAddressMap.this);
        edit = pref.edit();
        pd_main = ProgressDialog.show(PickAddressMap.this,"CabsWiki","Please Wait",false,false);
        count = 0;
        geocoder = new Geocoder(this, Locale.getDefault());
        lmngr = (LocationManager) getSystemService(LOCATION_SERVICE);

        btn_pickup.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                Intent result = new Intent();
                result.putExtra("loc_name", locationNameToBeSent);
                result.putExtra("loc_latlng", locationToBeSent);
                setResult(RESULT_OK, result);
                PickAddressMap.this.finish();
            }
        });
        iv_mylocation_pickaddress.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (ActivityCompat.checkSelfPermission(PickAddressMap.this, Manifest.permission.ACCESS_FINE_LOCATION)
                        != PackageManager.PERMISSION_GRANTED &&
                        ActivityCompat.checkSelfPermission(PickAddressMap.this, Manifest.permission.ACCESS_COARSE_LOCATION)
                                != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(PickAddressMap.this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 01);
                    return;
                }
                lmngr.requestLocationUpdates(lmngr.NETWORK_PROVIDER, 0, 0, new LocationListener() {
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
                permissionCheckCoarseLoc = ContextCompat.checkSelfPermission(PickAddressMap.this,
                        Manifest.permission.ACCESS_COARSE_LOCATION);
                Log.e("permission", "" + permissionCheckCoarseLoc);
                if (permissionCheckCoarseLoc == -1) {
                    ActivityCompat.requestPermissions(PickAddressMap.this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 01);
                } else {
                    final ProgressDialog pd = ProgressDialog.show(PickAddressMap.this, "CabsWiki", "Locating...", false, false);
                    new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            if (loc_picup != null) {
                                mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(loc_picup.getLatitude(), loc_picup.getLongitude()), 17f));
                                mMap.addMarker(new MarkerOptions().position(new LatLng(loc_picup.getLatitude(), loc_picup.getLongitude())));
                            } else {
                                Toast.makeText(PickAddressMap.this, "Retry or check GPS", Toast.LENGTH_SHORT).show();
                            }
                            pd.dismiss();
                        }
                    }, 3000);
                }
                Log.e("loca", "" + loc_picup);
            }
        });
        //Autocomplete Fragment
        autocompleteFragment.setOnPlaceSelectedListener(new PlaceSelectionListener() {
            @Override
            public void onPlaceSelected(Place place) {
                String placeName = "" + place.getName() + " " + place.getAddress().toString().replace(place.getName().toString(), "");
                locationNameToBeSent = placeName;
                LatLng placeLatLng = place.getLatLng();
                locationToBeSent = placeLatLng;
                mMap.clear();
                mMap.addMarker(new MarkerOptions().position(placeLatLng).title(placeName));
                mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(placeLatLng, 17f));
            }

            @Override
            public void onError(Status status) {
                Log.e("place", "error: " + status);
            }
        });
    }


    @Override
    public void onMapReady(GoogleMap googleMap) {
        mMap = googleMap;
        final float centreX = frg.getView().getX() + frg.getView().getWidth() / 2;
        final float centreY = frg.getView().getY() + frg.getView().getHeight() / 2;
        //final Point pu = new Point((int) centreX, (int) centreY);
        // Add a marker in Sydney and move the camera
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(PickAddressMap.this, new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, 1);
            return;
        }
        lmngr.requestLocationUpdates(lmngr.NETWORK_PROVIDER, 0, 0, new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                if (count == 0) {
                    LatLng pos = new LatLng(location.getLatitude(), location.getLongitude());
                    mMap.animateCamera(CameraUpdateFactory.newLatLngZoom(pos, 17f));
                    if (ActivityCompat.checkSelfPermission(PickAddressMap.this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(PickAddressMap.this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                        ActivityCompat.requestPermissions(PickAddressMap.this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 1);
                        return;
                    }
                    mMap.setMyLocationEnabled(true);
                    pd_main.dismiss();
                    count++;
                }
                //mMap.addMarker(new MarkerOptions().position(pos));
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
        mMap.setOnCameraMoveStartedListener(new GoogleMap.OnCameraMoveStartedListener() {
            @Override
            public void onCameraMoveStarted(int i) {
                mMap.clear();
                iv_marker.setVisibility(View.VISIBLE);
            }
        });
        mMap.setOnCameraIdleListener(new GoogleMap.OnCameraIdleListener() {
            @Override
            public void onCameraIdle() {
                mMap.clear();
                m = mMap.addMarker(new MarkerOptions().position(mMap.getCameraPosition().target).icon(BitmapDescriptorFactory.fromResource(R.mipmap.marker)));
                iv_marker.setVisibility(View.GONE);
                try {
                    List<Address> ls = geocoder.getFromLocation(m.getPosition().latitude, m.getPosition().longitude, 5);
                    for (int i = 0; i < ls.size(); i++) {
                        if (ls.size() > 0 && ls.get(0).getAddressLine(0) != null && ls.get(0).getAddressLine(1) != null && ls.get(0).getAddressLine(2) != null) {
                            Log.e("majidKhan", ls.get(0).getAddressLine(0));
                            Log.e("majidKhan", ls.get(0).getAddressLine(1));
                            Log.e("majidKhan", ls.get(0).getAddressLine(2));
                            String address = ls.get(0).getAddressLine(0) + " " + ls.get(0).getAddressLine(1) + " " + ls.get(0).getAddressLine(2);
                            etxt_showloc_pickaddr.setText(address);
                            locationNameToBeSent = address;
                            locationToBeSent = mMap.getCameraPosition().target;
                        }
                    }
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 01){
            if (grantResults[0] != 0){
                Toast.makeText(this, "Permission Not Granted", Toast.LENGTH_SHORT).show();
                edit.putInt("location_permission",0);
                edit.commit();
                pickup_overlay.setVisibility(View.VISIBLE);
                btn_pickup.setVisibility(View.GONE);
            }
            else {
                Toast.makeText(this, "Permission Granted", Toast.LENGTH_SHORT).show();
                edit.putInt("location_permission",1);
                edit.commit();
            }
        }
    }
}
