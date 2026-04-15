package com.khybertech.taxi360driver.JobView.UpdateJob;

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
import android.widget.DatePicker;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.TimePicker;
import android.widget.Toast;

import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.Maps.DropAddressMap;
import com.khybertech.taxi360driver.Maps.PickAddressMap;
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

public class UpdateJob extends AppCompatActivity {

    Toolbar toolbar_updatejob;
    Spinner spinner_updatejob_bookingtype,spinner_updatejob_passengers,spinner_updatejob_bags,spinner_updatejob_wheelchairs,spinner_updatejob_vehicletype;
    LinearLayout layout_updatejob_pickaddress,layout_updatejob_dropaddress,layout_datetime;
    TextView txt_pickaddr_pickup,txt_dropaddr_pickup,txt_updatejob_time,txt_updatejob_distance,txt_datetime_pickup;
    EditText etxt_passenger_id,etxt_updatejob_passengername,etxt_updatejob_extrainfo;

    TimePickerDialog timeDialog;
    DatePickerDialog dateDialog;

    String[] spinner_data_bookingtype = {"Full Vehicle","Shared Vehicle"};
    String[] spinner_data_passengers = {"0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20"};
    String[] spinner_data_wheelchairs = {"0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20"};
    String[] spinner_data_bags = {"0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20"};

    SecurePreferences pref;

    String passengerId,pickLatLng,dropLatLng,pickAddress,dropAddress,passengers,bags,wheelchairs
            ,bookingStatus,dateTime,estimatedDistance,estimatedTime,bookingId,info,bookingtype;

    String companyId;
    String nameReceived = "";
    String dateToBeSent = "";
    int driverID;
    LatLng locReceived = null;
    String[] spinner_data_vehicle_type;
    double lat_origin,lng_origin,lat_dest,lng_dest;
    HashMap<String,Object> hm_holding_vehicletype_id;
    //Job Updated not successfully
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_update_job);
        widgets();
        toolbarSetup();
//        pref = PreferenceManager.getDefaultSharedPreferences(UpdateJob.this);
        pref = appcontext.getInstance().pref;
        Intent intent = getIntent();
        //Variable Receiving
        Bundle b = intent.getBundleExtra("bundle");
        passengerId = b.getString("passengerId");
        pickLatLng = b.getString("pickLatLng");
        dropLatLng = b.getString("dropLatLng");
        pickAddress = b.getString("pickAddress");
        dropAddress = b.getString("dropAddress");
        passengers = b.getString("passengers");
        bags = b.getString("bags");
        wheelchairs = b.getString("wheelchairs");
        bookingStatus = b.getString("bookingStatus");
        dateTime = b.getString("dateTime");
        estimatedTime = b.getString("estimatedTime");
        estimatedDistance = b.getString("estimatedDistance");
        info = b.getString("info");
        bookingtype = b.getString("bookingType");
        companyId = pref.getString("company_id");
        bookingId = b.getString("bookingId");
        driverID = Integer.parseInt(appcontext.getInstance().DriverId);
        setUpbookingTypeSpinner();
        layout_updatejob_pickaddress.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                startActivityForResult(new Intent(UpdateJob.this, PickAddressMap.class),010);
            }
        });
        layout_updatejob_dropaddress.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (!nameReceived.equalsIgnoreCase("")) {
                    startActivityForResult(new Intent(UpdateJob.this, DropAddressMap.class), 011);
                }
                else {
                    Toast.makeText(UpdateJob.this, "Select Pick Up Location First", Toast.LENGTH_SHORT).show();
                }
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
                timeDialog = new TimePickerDialog(UpdateJob.this, new TimePickerDialog.OnTimeSetListener() {
                    @Override
                    public void onTimeSet(TimePicker timePicker, int selectedHour, int selectedMinute) {
                        dateToBeSent += " "+selectedHour+":"+selectedMinute;
                        txt_datetime_pickup.setText(dateToBeSent);
                    }
                },hour,minute,false);
                timeDialog.setTitle("Select Time");
                timeDialog.show();

                dateDialog = new DatePickerDialog(UpdateJob.this, new DatePickerDialog.OnDateSetListener() {
                    @Override
                    public void onDateSet(DatePicker datePicker, int year, int month, int day) {
                        dateToBeSent = ""+(month+1)+"/"+day+"/"+year;
                    }
                },year,month,day);
                dateDialog.show();
            }
        });
        setUpForm();
    }

    private void setUpbookingTypeSpinner() {
        ArrayAdapter<String> adapter_bookingtype = new ArrayAdapter<String>(getApplicationContext(),R.layout.row_spinner,R.id.txt_spinner_bookingtype_addjob,spinner_data_bookingtype);
        spinner_updatejob_bookingtype.setAdapter(adapter_bookingtype);

        ArrayAdapter<String> adapter_passengers = new ArrayAdapter<String>(getApplicationContext(),R.layout.row_spinner,R.id.txt_spinner_bookingtype_addjob,spinner_data_passengers);
        ArrayAdapter<String> adapter_bags = new ArrayAdapter<String>(getApplicationContext(),R.layout.row_spinner,R.id.txt_spinner_bookingtype_addjob,spinner_data_bags);
        ArrayAdapter<String> adapter_wheelchairs = new ArrayAdapter<String>(getApplicationContext(),R.layout.row_spinner,R.id.txt_spinner_bookingtype_addjob,spinner_data_wheelchairs);
        spinner_updatejob_passengers.setAdapter(adapter_passengers);
        spinner_updatejob_bags.setAdapter(adapter_bags);
        spinner_updatejob_wheelchairs.setAdapter(adapter_wheelchairs);
    }

    private void toolbarSetup() {
        setSupportActionBar(toolbar_updatejob);
        getSupportActionBar().setTitle("Update Job");
    }

    private void widgets() {
        toolbar_updatejob = (Toolbar) findViewById(R.id.toolbar_updatejob);
        spinner_updatejob_bookingtype = (Spinner) findViewById(R.id.spinner_updatejob_bookingtype);
        spinner_updatejob_passengers = (Spinner) findViewById(R.id.spinner_updatejob_passengers);
        spinner_updatejob_bags = (Spinner) findViewById(R.id.spinner_updatejob_bags);
        spinner_updatejob_wheelchairs = (Spinner)findViewById(R.id.spinner_updatejob_wheelchairs);
        layout_updatejob_pickaddress = (LinearLayout) findViewById(R.id.layout_updatejob_pickaddress);
        layout_updatejob_dropaddress = (LinearLayout) findViewById(R.id.layout_updatejob_dropaddress);
        txt_pickaddr_pickup = (TextView) findViewById(R.id.txt_pickaddr_pickup);
        txt_dropaddr_pickup = (TextView) findViewById(R.id.txt_dropaddr_pickup);
        spinner_updatejob_vehicletype = (Spinner) findViewById(R.id.spinner_updatejob_vehicletype);
        layout_datetime = (LinearLayout) findViewById(R.id.layout_datetime);
        txt_datetime_pickup = (TextView) findViewById(R.id.txt_datetime_pickup);
        txt_updatejob_time = (TextView) findViewById(R.id.txt_updatejob_time);
        txt_updatejob_distance = (TextView) findViewById(R.id.txt_updatejob_distance);
        etxt_updatejob_passengername = (EditText) findViewById(R.id.etxt_updatejob_passengername);
        etxt_updatejob_extrainfo = (EditText) findViewById(R.id.etxt_updatejob_extrainfo);
        etxt_passenger_id = (EditText) findViewById(R.id.etxt_passenger_id);
    }

    private void setUpForm(){
        etxt_passenger_id.setText(passengerId);
        txt_pickaddr_pickup.setText(pickAddress);
        txt_dropaddr_pickup.setText(dropAddress);
        //Booking Type Spinner
        for (int i = 0; i < spinner_data_bookingtype.length; i++){
            Log.e("spinnerCheck",spinner_data_bookingtype[i]);
            if (bookingtype.equalsIgnoreCase(spinner_data_bookingtype[i])){
                Log.e("spinnerCheck",""+i);
                spinner_updatejob_bookingtype.setSelection(i);
            }
        }
        //Passengers Type Spinner
        for (int i = 0; i < spinner_data_passengers.length; i++){
            Log.e("spinnerCheck",spinner_data_passengers[i]);
            if (passengers.equalsIgnoreCase(spinner_data_passengers[i])){
                Log.e("spinnerCheckPassenger",""+i);
                spinner_updatejob_passengers.setSelection(i);
            }
        }
        //Bags Type Spinner
        for (int i = 0; i < spinner_data_bags.length; i++){
            Log.e("spinnerCheck",spinner_data_bags[i]);
            if (bags.equalsIgnoreCase(spinner_data_bags[i])){
                Log.e("spinnerCheckPassenger",""+i);
                spinner_updatejob_bags.setSelection(i);
            }
        }
        //Wheel Chairs Type Spinner
        for (int i = 0; i < spinner_data_wheelchairs.length; i++){
            Log.e("spinnerCheck",spinner_data_wheelchairs[i]);
            if (wheelchairs.equalsIgnoreCase(spinner_data_wheelchairs[i])){
                Log.e("spinnerCheckPassenger",""+i);
                spinner_updatejob_wheelchairs.setSelection(i);
            }
        }

        etxt_updatejob_extrainfo.setText(info);

        txt_datetime_pickup.setText(dateTime);

        txt_updatejob_distance.setText(estimatedDistance);

        txt_updatejob_time.setText(estimatedTime);
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
                pickAddress = txt_pickaddr_pickup.getText().toString();
                dropAddress = txt_dropaddr_pickup.getText().toString();
                passengers = spinner_updatejob_passengers.getSelectedItem().toString();
                wheelchairs = spinner_updatejob_wheelchairs.getSelectedItem().toString();
                bags = spinner_updatejob_bags.getSelectedItem().toString();
                info = etxt_updatejob_extrainfo.getText().toString();
                dateTime = txt_datetime_pickup.getText().toString();
                bookingtype = spinner_updatejob_bookingtype.getSelectedItem().toString();
                estimatedDistance = txt_updatejob_distance.getText().toString();
                estimatedTime = txt_updatejob_time.getText().toString();
                String params = "PassengerId="+passengerId+"&PickLatLng="+pickLatLng+"&DropLatLng="+dropLatLng+"&PickAddress="+pickAddress+"&DropAddress="+dropAddress+"&Passengers="+passengers+"&Bags="+bags+"&WheelChairs="+wheelchairs+"&Info="+info+"&DateTime="+dateTime+"&BookingType="+bookingtype+"&EstimatedDistance="+estimatedDistance+"&EstimatedTime="+estimatedDistance+"&BookingId="+bookingId;

                new updateJobAsync().execute(params);
                Log.e("params",params);
                break;
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 010 && resultCode == RESULT_OK) {
            nameReceived = "" + data.getExtras().get("loc_name");
            locReceived = (LatLng) data.getExtras().get("loc_latlng");
            lat_origin = locReceived.latitude;
            lng_origin = locReceived.longitude;
            pickLatLng = ""+lat_origin+","+lng_origin;
            txt_pickaddr_pickup.setText(nameReceived);
        } else if (requestCode == 011 && resultCode == RESULT_OK) {
            nameReceived = "" + data.getExtras().get("loc_name");
            locReceived = (LatLng) data.getExtras().get("loc_latlng");
            lat_dest = locReceived.latitude;
            lng_dest = locReceived.longitude;
            txt_dropaddr_pickup.setText(nameReceived);
            dropLatLng = ""+lat_dest+","+lng_dest;
            new estimated().execute();
        }
    }

    public class loadVehicleType extends AsyncTask<Void,Void,String> {
        String data="";
        ProgressDialog pd;
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(UpdateJob.this,"Cabs Wiki","Loading Form",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);
                String params = "CompanyId="+companyId;
                Log.e("params",params);
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
                Log.e("Taxi360taxi",ex.getMessage());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            pd.dismiss();
            Log.e("params",s);
            try {
                hm_holding_vehicletype_id = new HashMap<>();
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
                Log.e("params",""+spinner_data_vehicle_type);
                ArrayAdapter<String> adapter = new ArrayAdapter<String>(getApplicationContext(),R.layout.row_spinner,R.id.txt_spinner_bookingtype_addjob,spinner_data_vehicle_type);
                spinner_updatejob_vehicletype.setAdapter(adapter);
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
            pd = ProgressDialog.show(UpdateJob.this,"CabsWiki","Estimating",false,false);
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
                txt_updatejob_distance.setText(txt_distance);
                txt_updatejob_time.setText(txt_duration);
            }
            catch (Exception ex){

            }
        }
    }

    public class updateJobAsync extends AsyncTask<String,Void,String>{
        ProgressDialog pd;
        String data = "";
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(UpdateJob.this,"CabsWiki","Updating job",false,false);
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
                Log.e("amaddd",strings[0]);
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
            Log.e("amaddd",s);
            if (s.equalsIgnoreCase("Job Updated  Successfully")){
                Toast.makeText(UpdateJob.this, s, Toast.LENGTH_SHORT).show();
                UpdateJob.this.finish();
            }
            else {
                Toast.makeText(UpdateJob.this, "Something Went Wrong", Toast.LENGTH_SHORT).show();
            }
            /*try {
                JSONObject obj = new JSONObject(s);
                String BookingMessage = obj.getString("BookingMessage");
                Toast.makeText(UpdateJob.this, BookingMessage, Toast.LENGTH_SHORT).show();
                UpdateJob.this.finish();
            }
            catch (Exception ex){

            }*/
        }
    }
}
