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

public class DropAddressMap extends FragmentActivity implements OnMapReadyCallback {

    private GoogleMap mMap;
    SupportMapFragment frg;
    Marker m = null;
    ImageView iv_marker;
    Geocoder geocoder;
    EditText etxt_showloc_dropaddr;
    ImageView iv_mylocation_dropaddress;
    Button btn_drop;
    LocationManager lmngr;
    Location loc_picup = null;
    SharedPreferences pref;
    SharedPreferences.Editor edit;
    LinearLayout drop_overlay;
    PlaceAutocompleteFragment autocompleteFragment;
    String placeName = "";
    LatLng placeLatLng = null;
    String locationNameToBeSent;
    LatLng locationToBeSent = null;
    int count;
    ProgressDialog pd_main;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_drop_address_map);
        frg = (SupportMapFragment) getSupportFragmentManager().findFragmentById(R.id.map);
        frg.getMapAsync(this);
        iv_marker= (ImageView) findViewById(R.id.iv_marker);
        etxt_showloc_dropaddr = (EditText) findViewById(R.id.etxt_showloc_dropaddr);
        iv_mylocation_dropaddress = (ImageView) findViewById(R.id.iv_mylocation_dropaddress);
        autocompleteFragment = (PlaceAutocompleteFragment) getFragmentManager().findFragmentById(R.id.autocomplete_drop_location);
        btn_drop = (Button) findViewById(R.id.btn_drop);
        drop_overlay = (LinearLayout) findViewById(R.id.drop_overlay);
        pref = PreferenceManager.getDefaultSharedPreferences(DropAddressMap.this);
        edit = pref.edit();
        count = 0;
        pd_main = ProgressDialog.show(DropAddressMap.this,"CabsWiki","Please Wait",false,false);
        lmngr = (LocationManager)getSystemService(LOCATION_SERVICE);
        /*etxt_location_dropaddress.setOnKeyListener(new View.OnKeyListener() {
            @Override
            public boolean onKey(View view, int i, KeyEvent keyEvent) {

                return false;
            }
        });*/
        btn_drop.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                Intent result = new Intent();
                result.putExtra("loc_name",locationNameToBeSent);
                result.putExtra("loc_latlng",locationToBeSent);
                double d = locationToBeSent.latitude;
                Log.e("sentLoc",""+locationToBeSent);
                Log.e("sentLoc",""+d);
                setResult(RESULT_OK,result);
                DropAddressMap.this.finish();
            }
        });
        iv_mylocation_dropaddress.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (ActivityCompat.checkSelfPermission(DropAddressMap.this, Manifest.permission.ACCESS_FINE_LOCATION)
                        != PackageManager.PERMISSION_GRANTED &&
                        ActivityCompat.checkSelfPermission(DropAddressMap.this, Manifest.permission.ACCESS_COARSE_LOCATION)
                                != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(DropAddressMap.this,new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},01);
                    return;
                }
                lmngr.requestLocationUpdates(lmngr.NETWORK_PROVIDER, 0, 0, new LocationListener() {
                    @Override
                    public void onLocationChanged(Location location) {
                        Log.e("dest_loc",""+location);
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
                    final ProgressDialog pd = ProgressDialog.show(DropAddressMap.this,"CabsWiki","Locating...",false,false);
                    new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            if (loc_picup != null){
                                mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(loc_picup.getLatitude(),loc_picup.getLongitude()),17f));
                                mMap.addMarker(new MarkerOptions().position(new LatLng(loc_picup.getLatitude(),loc_picup.getLongitude())));
                            }
                            else {
                                Toast.makeText(DropAddressMap.this, "Retry or check GPS", Toast.LENGTH_SHORT).show();
                            }
                            pd.dismiss();
                        }
                    }, 3000);
                Log.e("loca",""+loc_picup);
            }
        });

        //Autocomplete Fragment
        autocompleteFragment.setOnPlaceSelectedListener(new PlaceSelectionListener() {
            @Override
            public void onPlaceSelected(Place place) {
                placeName = ""+place.getName()+" "+place.getAddress().toString().replace(place.getName().toString(), "");
                locationNameToBeSent = placeName;
                placeLatLng = place.getLatLng();
                locationToBeSent = placeLatLng;
                mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(placeLatLng,17f));
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
        // Add a marker in Sydney and move the camera
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(DropAddressMap.this, new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, 1);
            return;
        }
        lmngr.requestLocationUpdates(lmngr.NETWORK_PROVIDER, 0, 0, new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                if (count == 0) {
                    LatLng pos = new LatLng(location.getLatitude(), location.getLongitude());
                    mMap.animateCamera(CameraUpdateFactory.newLatLngZoom(pos, 18f));
                    if (ActivityCompat.checkSelfPermission(DropAddressMap.this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(DropAddressMap.this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                        ActivityCompat.requestPermissions(DropAddressMap.this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 1);
                        return;
                    }
                    mMap.setMyLocationEnabled(true);
                    pd_main.dismiss();
                    count ++;
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

        mMap.setOnCameraMoveListener(new GoogleMap.OnCameraMoveListener() {
            @Override
            public void onCameraMove() {
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
                        Log.e("count",""+i);
                        if (ls.size() > 0) {
                            String address = ls.get(0).getAddressLine(0) + " " + ls.get(0).getAddressLine(1) + " " + ls.get(0).getAddressLine(2)+ " " + ls.get(0).getAddressLine(3)+ " " + ls.get(0).getAddressLine(4);
                            locationNameToBeSent = address;
                            locationToBeSent = mMap.getCameraPosition().target;
                            etxt_showloc_dropaddr.setText(address.replace("null",""));
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
                drop_overlay.setVisibility(View.VISIBLE);
                btn_drop.setVisibility(View.GONE);
            }
            else {
                Toast.makeText(this, "Permission Granted", Toast.LENGTH_SHORT).show();
                edit.putInt("location_permission",1);
                edit.commit();
            }
        }
    }
}
